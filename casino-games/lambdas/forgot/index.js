const {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    if (!body.email) {
      return response(400, { error: "email is required" });
    }

    const result = await client.send(
      new ForgotPasswordCommand({
        ClientId: process.env.USER_POOL_CLIENT_ID,
        Username: body.email,
      })
    );

    return response(200, {
      message: "Password reset code sent to your email.",
      result,
    });
  } catch (err) {
    console.error("ForgotPassword error:", err);
    return response(400, { error: err.message || "Failed to send reset code" });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
    },
    body: JSON.stringify(body),
  };
}
