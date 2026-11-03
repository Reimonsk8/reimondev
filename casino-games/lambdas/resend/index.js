const {
  CognitoIdentityProviderClient,
  ResendConfirmationCodeCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-2',
});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    if (!body.email) return response(400, { error: 'email is required' });

    const result = await client.send(new ResendConfirmationCodeCommand({
      ClientId: process.env.USER_POOL_CLIENT_ID,
      Username: body.email,
    }));

    return response(200, {
      message: 'Verification code resent successfully.',
      result,
    });
  } catch (error) {
    console.error('Resend confirmation failed:', error?.name || 'UnknownError');
    return response(400, { error: error?.message || 'Resend failed' });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,POST',
    },
    body: JSON.stringify(body),
  };
}
