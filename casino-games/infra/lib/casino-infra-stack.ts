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

    // The hosted domain and Google IdP were provisioned directly in the target
    // account. Keep them externally managed here to avoid CDK attempting to
    // create duplicate Cognito resources during stack reconciliation.
    const domainPrefix = this.node.tryGetContext('cognitoDomainPrefix') || 'reimondev';
    const gamesBaseUrl = this.node.tryGetContext('gamesBaseUrl') || 'https://reimondev.com/games';

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
          cognito.OAuthScope.PHONE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: [`${gamesBaseUrl}/oauth2/callback`],
        logoutUrls: [`${gamesBaseUrl}/`],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
    });

    // 3. DynamoDB Tables
    // Users Table - stores wallet balance and user info
    const usersTable = new dynamodb.Table(this, 'CasinoUsersTable', {
      tableName: 'casino-users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Preserve the target account's existing email lookup index. This table
    // already contains data, so don't let CDK interpret the unmanaged GSI as
    // something to remove during stack reconciliation.
    usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
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

    // Transactions Table - stores all wallet transactions
    const transactionsTable = new dynamodb.Table(this, 'CasinoTransactionsTable', {
      tableName: 'casino-transactions',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Multiplayer Blackjack room state (single global table; engine is server-authoritative)
    const blackjackRoomsTable = new dynamodb.Table(this, 'BlackjackRoomsTable', {
      tableName: 'blackjack-rooms',
      partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
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

    const gameRoundsTable = new dynamodb.Table(this, 'GameRoundsTable', {
      tableName: 'casino-game-rounds',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'recordId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const walletLinksTable = new dynamodb.Table(this, 'WalletLinksTable', {
      tableName: 'casino-wallet-links',
      partitionKey: { name: 'recordId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiresAt',
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
        TRANSACTIONS_TABLE_NAME: transactionsTable.tableName,
        GAME_ROUNDS_TABLE_NAME: gameRoundsTable.tableName,
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
        GAME_ROUNDS_TABLE_NAME: gameRoundsTable.tableName,
        WALLET_LINKS_TABLE_NAME: walletLinksTable.tableName,
        BLACKJACK_ROOMS_TABLE_NAME: blackjackRoomsTable.tableName,
      },
    });

    // Wallet Lambda Functions
    const getUserProfileLambda = new lambda.Function(this, 'GetUserProfileLambda', {
      ...commonLambdaProps,
      functionName: 'casino-get-user-profile',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/getUserProfile'),
    });

    const getTransactionHistoryLambda = new lambda.Function(this, 'GetTransactionHistoryLambda', {
      ...commonLambdaProps,
      functionName: 'casino-get-transaction-history',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/getTransactionHistory'),
    });

    const depositFundsLambda = new lambda.Function(this, 'DepositFundsLambda', {
      ...commonLambdaProps,
      functionName: 'casino-deposit-funds',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/depositFunds'),
    });

    const withdrawFundsLambda = new lambda.Function(this, 'WithdrawFundsLambda', {
      ...commonLambdaProps,
      functionName: 'casino-withdraw-funds',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/withdrawFunds'),
    });

    const placeBetLambda = new lambda.Function(this, 'PlaceBetLambda', {
      ...commonLambdaProps,
      functionName: 'casino-place-bet',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/placeBet'),
    });

    const walletLinkLambda = new lambda.Function(this, 'WalletLinkLambda', {
      ...commonLambdaProps,
      functionName: 'casino-wallet-link',
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/walletLink', { exclude: ['node_modules', 'source.js', '*.test.js', 'package*.json'] }),
      environment: {
        ...commonLambdaProps.environment,
        WALLET_LINKS_TABLE_NAME: walletLinksTable.tableName,
        APP_ORIGIN: new URL(gamesBaseUrl).origin,
      },
    });

    const playersStatusLambda = new lambda.Function(this, 'PlayersStatusLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/players/status'),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
      },
    });

    // Leaderboard Lambda - returns top winners for each game
    const leaderboardLambda = new lambda.Function(this, 'LeaderboardLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/games/leaderboard'),

      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        TRANSACTIONS_TABLE_NAME: transactionsTable.tableName,
      },
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

    // Grant DynamoDB permissions to wallet Lambdas
    usersTable.grantReadWriteData(getUserProfileLambda);
    usersTable.grantReadWriteData(depositFundsLambda);
    usersTable.grantReadWriteData(withdrawFundsLambda);
    usersTable.grantReadWriteData(placeBetLambda);
    usersTable.grantReadData(playersStatusLambda);

    // Delete-account needs full read/write across user-owned tables for cleanup
    usersTable.grantReadWriteData(deleteAccountLambda);
    transactionsTable.grantReadWriteData(deleteAccountLambda);
    playersTable.grantReadWriteData(deleteAccountLambda);
    connectionsTable.grantReadWriteData(deleteAccountLambda);
    gameRoundsTable.grantReadWriteData(deleteAccountLambda);
    walletLinksTable.grantReadWriteData(deleteAccountLambda);
    blackjackRoomsTable.grantReadWriteData(deleteAccountLambda);

    transactionsTable.grantReadData(getTransactionHistoryLambda);
    transactionsTable.grantWriteData(depositFundsLambda);
    transactionsTable.grantWriteData(withdrawFundsLambda);
    transactionsTable.grantWriteData(placeBetLambda);
    gameRoundsTable.grantReadWriteData(placeBetLambda);
    gameRoundsTable.grantReadWriteData(depositFundsLambda);
    gameRoundsTable.grantReadWriteData(withdrawFundsLambda);
    walletLinksTable.grantReadWriteData(walletLinkLambda);
    usersTable.grantReadData(walletLinkLambda);
    usersTable.grant(walletLinkLambda, 'dynamodb:ConditionCheckItem');

    connectionsTable.grantReadData(playersStatusLambda);

    // Grant permissions to leaderboard Lambda
    usersTable.grantReadData(leaderboardLambda);
    transactionsTable.grantReadData(leaderboardLambda);

    // 5. API Gateway
    const api = new apigw.RestApi(this, 'CasinoAuthApi', {
      restApiName: 'casino-auth-api',
      description: 'Auth API for casino login/signup',
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

    // Wallet endpoints - all protected by Cognito authorizer
    const walletResource = api.root.addResource('wallet');

    const walletProfileResource = walletResource.addResource('profile');
    walletProfileResource.addMethod('GET', new apigw.LambdaIntegration(getUserProfileLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
    walletProfileResource.addMethod('POST', new apigw.LambdaIntegration(getUserProfileLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    walletResource.addResource('transactions')
      .addMethod('GET', new apigw.LambdaIntegration(getTransactionHistoryLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    walletResource.addResource('deposit')
      .addMethod('POST', new apigw.LambdaIntegration(depositFundsLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    walletResource.addResource('withdraw')
      .addMethod('POST', new apigw.LambdaIntegration(withdrawFundsLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    const walletBetResource = walletResource.addResource('bet');
    walletBetResource.addMethod('POST', new apigw.LambdaIntegration(placeBetLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });
    walletBetResource.addMethod('GET', new apigw.LambdaIntegration(placeBetLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    const walletLinkResource = walletResource.addResource('link');
    walletLinkResource.addMethod('GET', new apigw.LambdaIntegration(walletLinkLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    walletLinkResource.addMethod('POST', new apigw.LambdaIntegration(walletLinkLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });
    walletLinkResource.addResource('nonce').addMethod('POST', new apigw.LambdaIntegration(walletLinkLambda), {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    });

    const playersResource = api.root.addResource('players');
    playersResource.addResource('status')
      .addMethod('GET', new apigw.LambdaIntegration(playersStatusLambda), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    // Games endpoints
    const gamesResource = api.root.addResource('games');
    gamesResource.addResource('leaderboard')
      .addMethod('GET', new apigw.LambdaIntegration(leaderboardLambda)); // Public endpoint, no auth required

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
        BLACKJACK_ROOMS_TABLE_NAME: blackjackRoomsTable.tableName,
        USERS_TABLE_NAME: usersTable.tableName,
        TRANSACTIONS_TABLE_NAME: transactionsTable.tableName,
        GAME_ROUNDS_TABLE_NAME: gameRoundsTable.tableName,
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
        BLACKJACK_ROOMS_TABLE_NAME: blackjackRoomsTable.tableName,
        SOS_ROOMS_TABLE_NAME: sosRoomsTable.tableName,
        RATE_LIMITS_TABLE_NAME: rateLimitsTable.tableName,
        USERS_TABLE_NAME: usersTable.tableName,
        TRANSACTIONS_TABLE_NAME: transactionsTable.tableName,
        // Construct API Gateway REST URL dynamically
        API_ENDPOINT: `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod`,
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

    blackjackRoomsTable.grantReadWriteData(webSocketMessageFn);
    blackjackRoomsTable.grantReadWriteData(webSocketDisconnectFn);
sosRoomsTable.grantReadWriteData(webSocketMessageFn);
sosRoomsTable.grantReadWriteData(webSocketDisconnectFn);
    usersTable.grantReadWriteData(webSocketDisconnectFn);
    transactionsTable.grantWriteData(webSocketDisconnectFn);
    gameRoundsTable.grantReadWriteData(webSocketDisconnectFn);

    rateLimitsTable.grantReadWriteData(webSocketMessageFn);
    usersTable.grantReadWriteData(webSocketMessageFn);
    transactionsTable.grantWriteData(webSocketMessageFn);

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
      ['PlaceBet', placeBetLambda],
      ['Deposit', depositFundsLambda],
      ['Withdraw', withdrawFundsLambda],
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
