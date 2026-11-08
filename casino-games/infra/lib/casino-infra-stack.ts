import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigwv2Integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export class CasinoInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Cognito User Pool
    const userPool = new cognito.UserPool(this, 'CasinoUserPool', {
      userPoolName: 'casino-user-pool',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    const domainPrefix = this.node.tryGetContext('cognitoDomainPrefix') || 'reimondev';
    const gamesBaseUrl = this.node.tryGetContext('gamesBaseUrl') || 'https://reimondev.com/games';
    // Keep the currently registered Netlify callback during the move to the
    // integrated /games/ route; remove it only after that host is retired.
    const legacyGamesBaseUrl = this.node.tryGetContext('legacyGamesBaseUrl') || 'https://chimerical-capybara-0b55e9.netlify.app';
    // The active Cognito domain and Google IdP were provisioned outside this
    // stack. Reuse them rather than attempting to recreate the domain/provider
    // or requiring the Google client secret during unrelated infrastructure updates.

    // 2. App Client sin secret
    const userPoolClient = userPool.addClient('CasinoUserPoolClient', {
      userPoolClientName: 'casino-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [...new Set([
          `${gamesBaseUrl}/oauth2/callback`,
          `${legacyGamesBaseUrl}/oauth2/callback`,
        ])],
        logoutUrls: [...new Set([
          `${gamesBaseUrl}/`,
          legacyGamesBaseUrl,
        ])],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
    });

    // 3. DynamoDB Tables
    // Shared player identity/profile table. Its historical physical name is
    // retained to preserve existing Cognito-user profile data.
    const usersTable = new dynamodb.Table(this, 'CasinoUsersTable', {
      tableName: 'casino-users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Players Table - tracks active player positions and states
    const playersTable = new dynamodb.Table(this, 'CasinoPlayersTable', {
      tableName: 'casino-players',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying by userId
    playersTable.addGlobalSecondaryIndex({
      indexName: 'userIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Connections Table - maps WebSocket connection IDs to user IDs
    const connectionsTable = new dynamodb.Table(this, 'CasinoConnectionsTable', {
      tableName: 'casino-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'ttl',
    });

    // Square of Shadows online rooms. One item per invite code; holds the
    // serialized authoritative game state plus the current turn deadline.
    // TTL reaps abandoned lobbies so play-money DynamoDB cost stays flat.
    const sosRoomsTable = new dynamodb.Table(this, 'SosRoomsTable', {
      tableName: 'sos-rooms',
      partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // Rate-limit buckets (WS abuse throttle for chat/emotes). TTL cleans up keys
    // automatically; a conditional put on a bucket key is the "gate".
    const rateLimitsTable = new dynamodb.Table(this, 'RateLimitsTable', {
      tableName: 'casino-rate-limits',
      partitionKey: { name: 'key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'ttl',
    });

    // 4. Propiedades comunes de las Lambdas
    // logRetention = 7 días para que CloudWatch Logs no acumule almacenamiento.
    // Sin reservedConcurrentExecutions: el límite de concurrencia de la cuenta es 10
    // (mínimo unreserved 10), así que reservar cualquier lambda falla el deploy.
    // El techo real de costo lo pone el límite de cuenta + budget mensual + throttling.
    const commonLambdaProps: Omit<lambda.FunctionProps, 'code' | 'handler' | 'functionName'> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        USERS_TABLE_NAME: usersTable.tableName,
      },
    };

    const signupLambda = new lambda.Function(this, 'SignupLambda', {
      ...commonLambdaProps,
      functionName: 'casino-signup',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/signup'),
    });

    const verifyLambda = new lambda.Function(this, 'VerifyLambda', {
      ...commonLambdaProps,
      functionName: 'casino-verify',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/verify'),
    });

    // Keep these existing target-account routes in the managed stack. They are
    // still present in the deployed API and must not be removed by a CDK update.
    const resendLambda = new lambda.Function(this, 'ResendLambda', {
      ...commonLambdaProps,
      functionName: 'casino-resend-code',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/resend'),
    });

    const loginLambda = new lambda.Function(this, 'LoginLambda', {
      ...commonLambdaProps,
      functionName: 'casino-login',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/login'),
    });

    const forgotLambda = new lambda.Function(this, 'ForgotLambda', {
      ...commonLambdaProps,
      functionName: 'casino-forgot-password',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/forgot'),
    });

    const confirmForgotLambda = new lambda.Function(this, 'ConfirmForgotLambda', {
      ...commonLambdaProps,
      functionName: 'casino-confirm-forgot-password',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/confirm-forgot'),
    });

    const meLambda = new lambda.Function(this, 'MeLambda', {
      ...commonLambdaProps,
      functionName: 'casino-me',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/me'),
    });

    // NUEVA LAMBDA /auth/me
    // LAMBDA /auth/delete-account - deletes Cognito user + all DynamoDB records
    const deleteAccountLambda = new nodejs.NodejsFunction(this, 'DeleteAccountLambda', {
      ...commonLambdaProps,
      functionName: 'casino-delete-account',
      entry: 'lambdas/delete-account/index.js',
      handler: 'handler',
      bundling: { externalModules: [] },
      environment: {
        ...commonLambdaProps.environment,
        PLAYERS_TABLE_NAME: playersTable.tableName,
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
        SOS_ROOMS_TABLE_NAME: sosRoomsTable.tableName,
      },
    });

    const getUserProfileLambda = new lambda.Function(this, 'GetUserProfileLambda', {
      ...commonLambdaProps,
      functionName: 'casino-get-user-profile',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/getUserProfile'),
    });

    // PERMISOS CORRECTOS ✔
    userPool.grant(signupLambda, 'cognito-idp:SignUp');
    userPool.grant(verifyLambda, 'cognito-idp:ConfirmSignUp');
    userPool.grant(resendLambda, 'cognito-idp:ResendConfirmationCode');
    userPool.grant(loginLambda, 'cognito-idp:InitiateAuth');
    userPool.grant(forgotLambda, 'cognito-idp:ForgotPassword');
    userPool.grant(confirmForgotLambda, 'cognito-idp:ConfirmForgotPassword');
    userPool.grant(meLambda, 'cognito-idp:GetUser');
    userPool.grant(deleteAccountLambda, 'cognito-idp:AdminDeleteUser'); // para /auth/delete-account

    // Player identity/profile is shared by both retained games.
    usersTable.grantReadWriteData(getUserProfileLambda);

    // Delete-account needs full read/write across user-owned tables for cleanup
    usersTable.grantReadWriteData(deleteAccountLambda);
    playersTable.grantReadWriteData(deleteAccountLambda);
    connectionsTable.grantReadWriteData(deleteAccountLambda);
    sosRoomsTable.grantReadWriteData(deleteAccountLambda);

    // 5. API Gateway
    const api = new apigw.RestApi(this, 'CasinoAuthApi', {
      restApiName: 'casino-auth-api',
      description: 'Shared ReimonDev game identity API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 20,
        throttlingBurstLimit: 10,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CasinoAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const gatewayCorsHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'*'",
      'Access-Control-Allow-Methods': "'*'",
    };

    api.addGatewayResponse('GatewayResponseUnauthorized', {
      type: apigw.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: gatewayCorsHeaders,
    });

    api.addGatewayResponse('GatewayResponseAccessDenied', {
      type: apigw.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: gatewayCorsHeaders,
    });

    const authResource = api.root.addResource('auth');

    authResource.addResource('signup')
      .addMethod('POST', new apigw.LambdaIntegration(signupLambda));

    authResource.addResource('verify')
      .addMethod('POST', new apigw.LambdaIntegration(verifyLambda));

    authResource.addResource('resend')
      .addMethod('POST', new apigw.LambdaIntegration(resendLambda));

    authResource.addResource('login')
      .addMethod('POST', new apigw.LambdaIntegration(loginLambda));

    authResource.addResource('me')
      .addMethod('GET', new apigw.LambdaIntegration(meLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    authResource.addResource('forgot')
      .addMethod('POST', new apigw.LambdaIntegration(forgotLambda));

    authResource.addResource('confirm-forgot-password')
      .addMethod('POST', new apigw.LambdaIntegration(confirmForgotLambda));

    // /auth/delete-account - self-service account deletion (Cognito + DynamoDB)
    authResource.addResource('delete-account')
      .addMethod('POST', new apigw.LambdaIntegration(deleteAccountLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    // Legacy path retained for the shared player profile endpoint. It no longer
    // reads or writes wallet balances or game statistics.
    const walletProfileResource = api.root.addResource('wallet').addResource('profile');
    walletProfileResource.addMethod('GET', new apigw.LambdaIntegration(getUserProfileLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
    walletProfileResource.addMethod('POST', new apigw.LambdaIntegration(getUserProfileLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    // Outputs
    new CfnOutput(this, 'ApiBaseUrl', {
      value: api.url ?? 'NO-URL',
    });

    new CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'CognitoDomain', {
      value: `${domainPrefix}.auth.${this.region}.amazoncognito.com`,
    });

    // =====================================
    // WebSocket API for Real-time Features
    // =====================================

    // --- WebSocket Lambdas ---
    const webSocketConnectFn = new nodejs.NodejsFunction(this, 'WebSocketConnectHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      entry: 'lambdas/websocket/connect/index.js',
      handler: 'handler',
      bundling: { externalModules: [] },
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
        PLAYERS_TABLE_NAME: playersTable.tableName,
        USERS_TABLE_NAME: usersTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const webSocketDisconnectFn = new nodejs.NodejsFunction(this, 'WebSocketDisconnectHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      entry: 'lambdas/websocket/disconnect/index.js',
      handler: 'handler',
      bundling: { externalModules: [] },
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
        PLAYERS_TABLE_NAME: playersTable.tableName,
        SOS_ROOMS_TABLE_NAME: sosRoomsTable.tableName,
      },
    });

    const webSocketMessageFn = new nodejs.NodejsFunction(this, 'WebSocketMessageHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      entry: 'lambdas/websocket/message/index.js',
      handler: 'handler',
      bundling: { externalModules: [] },
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
        PLAYERS_TABLE_NAME: playersTable.tableName,
        SOS_ROOMS_TABLE_NAME: sosRoomsTable.tableName,
        RATE_LIMITS_TABLE_NAME: rateLimitsTable.tableName,
      },
    });

    const webSocketMoveFn = new nodejs.NodejsFunction(this, 'WebSocketMoveHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      entry: 'lambdas/websocket/move/index.js',
      handler: 'handler',
      bundling: { externalModules: [] },
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
        PLAYERS_TABLE_NAME: playersTable.tableName,
      },
    });

    // --- Grant DynamoDB permissions to WebSocket Lambdas ---
    connectionsTable.grantReadWriteData(webSocketConnectFn);
    connectionsTable.grantReadWriteData(webSocketDisconnectFn);
    connectionsTable.grantReadWriteData(webSocketMessageFn);
    connectionsTable.grantReadWriteData(webSocketMoveFn);

    playersTable.grantReadWriteData(webSocketConnectFn);
    playersTable.grantReadWriteData(webSocketDisconnectFn);
    playersTable.grantReadWriteData(webSocketMessageFn);
    playersTable.grantReadWriteData(webSocketMoveFn);

    // Connect reads the users table for authoritative nickname/avatar
    usersTable.grantReadData(webSocketConnectFn);
    usersTable.grant(webSocketConnectFn, 'dynamodb:ConditionCheckItem');

    sosRoomsTable.grantReadWriteData(webSocketMessageFn);
    sosRoomsTable.grantReadWriteData(webSocketDisconnectFn);
    sosRoomsTable.grantReadWriteData(deleteAccountLambda);

    rateLimitsTable.grantReadWriteData(webSocketMessageFn);

    // --- WebSocket API ---
    const webSocketApi = new apigwv2.WebSocketApi(this, 'CasinoWebSocketApi', {
      apiName: 'casino-websocket-api',
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('ConnectIntegration', webSocketConnectFn),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', webSocketDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('DefaultIntegration', webSocketMessageFn),
      },
    });

    const webSocketStage = new apigwv2.WebSocketStage(this, 'CasinoWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
      throttle: { rateLimit: 60, burstLimit: 30 },
    });

    const websocketEndpoint = webSocketStage.url;
    [webSocketConnectFn, webSocketDisconnectFn, webSocketMessageFn, webSocketMoveFn].forEach((fn) => {
      fn.addEnvironment('WEBSOCKET_ENDPOINT', websocketEndpoint);
    });
    deleteAccountLambda.addEnvironment('WEBSOCKET_ENDPOINT', websocketEndpoint);

    // --- Custom Route: 'move' ---
    webSocketApi.addRoute('move', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration('MoveIntegration', webSocketMoveFn),
    });

    // --- Allow Lambdas to call PostToConnection on WebSocket API ---
    const manageConnectionsPolicy = new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/*/*`,
      ],
    });

    [webSocketConnectFn, webSocketDisconnectFn, webSocketMessageFn, webSocketMoveFn, deleteAccountLambda].forEach((fn) => {
      fn.addToRolePolicy(manageConnectionsPolicy);
    });

    // --- Outputs ---
    new CfnOutput(this, 'WebSocketApiUrl', {
      value: webSocketStage.url,
      description: 'WebSocket API endpoint (use wss:// protocol)',
    });

    // --------------------------------------------------------------------
    // CloudWatch alarms on key lambdas (any Errors in two consecutive 5-min
    // windows). Email alerts only fire when context.budgetEmail is set (same
    // email as the budget alerts); otherwise the alarms still go to the Alarm
    // list in the console.
    // --------------------------------------------------------------------
    const alarmEmail = this.node.tryGetContext('budgetEmail') || '';
    const alarmTopic = alarmEmail
      ? new sns.Topic(this, 'CasinoAlarmTopic', { displayName: 'casino888-alerts' })
      : undefined;
    if (alarmEmail && alarmTopic) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
    }

    const keyLambdas = [
      ['Login', loginLambda],
      ['WsMessage', webSocketMessageFn],
      ['WsConnect', webSocketConnectFn],
    ] as const;
    keyLambdas.forEach(([id, fn]) => {
      const alarm = new cloudwatch.Alarm(this, `${id}ErrorAlarm`, {
        metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 0,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmName: `casino888-${id}-errors`,
      });
      if (alarmTopic) alarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    });

    // --------------------------------------------------------------------
    // Presupuesto mensual (spending guardrail)
    // Límite de $30/mes con alertas por email. Sin email configurado, crea
    // igualmente el budget (se ve en Cost Explorer) pero sin notificaciones.
    // Pon tu email en cdk.json -> context.budgetEmail y vuelve a desplegar.
    // --------------------------------------------------------------------
    const budgetEmail = this.node.tryGetContext('budgetEmail') || '';
    const budgetLimit = this.node.tryGetContext('budgetLimit') || 30;

    new budgets.CfnBudget(this, 'CasinoMonthlyBudget', {
      budget: {
        budgetName: 'casino888-dev-budget',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: budgetLimit, unit: 'USD' },
        costTypes: {
          includeTax: true,
          includeSubscription: true,
          includeSupport: true,
          includeDiscount: true,
          includeRefund: false,
          includeCredit: false,
          includeUpfront: true,
          includeRecurring: true,
          includeOtherSubscription: true,
          useBlended: false,
        },
      },
      resourceTags: [{ key: 'Project', value: 'casino888' }],
      notificationsWithSubscribers: budgetEmail
        ? [
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 50,
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
            },
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 80,
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
            },
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 100,
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
            },
          ]
        : undefined,
    });
  }
}
