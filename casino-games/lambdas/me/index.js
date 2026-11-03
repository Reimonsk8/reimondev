const {
  CognitoIdentityProviderClient,
  GetUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-2',
});

exports.handler = async (event) => {
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  if (!authHeader) {
    return response(401, { error: 'Missing Authorization header' });
  }

  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return response(401, { error: 'Missing Authorization token' });

  try {
    const user = await client.send(new GetUserCommand({ AccessToken: accessToken }));
    return response(200, { message: 'Profile info', user });
  } catch (error) {
    console.error('Cognito GetUser failed:', error?.name || 'UnknownError');
    return response(401, {
      error: 'Invalid or expired token',
      details: error?.message || 'Unauthorized',
    });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
