const {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    if (!body.email || !body.code || !body.password) {
      return response(400, { error: "email, code and password are required" });
    }

    const result = await client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.USER_POOL_CLIENT_ID,
        Username: body.email,
        ConfirmationCode: body.code,
        Password: body.password,
      })
    );

    return response(200, {
      message: "Password reset successfully. You can now log in.",
      result,
    });
  } catch (err) {
    console.error("ConfirmForgotPassword error:", err);
    return response(400, { error: err.message || "Password reset failed" });
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
