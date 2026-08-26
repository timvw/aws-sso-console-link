const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSsoUrl,
  extractIdentity,
  extractPermissionSetName,
  normalizePortalUrl,
  normalizeAccountId,
} = require("../aws-sso-console-link.user.js");

test("extracts the current AWS account ID", () => {
  assert.equal(normalizeAccountId("Account ID 1234-5678-9012"), "123456789012");
  assert.equal(
    normalizeAccountId("example-production (123456789012)"),
    "123456789012",
  );
});

test("extracts display and generated Identity Center role names", () => {
  assert.equal(
    extractPermissionSetName("ReadOnlyAccess/alice"),
    "ReadOnlyAccess",
  );
  assert.equal(
    extractPermissionSetName(
      "AWSReservedSSO_ReadOnlyAccess_0123456789abcdef/alice",
    ),
    "ReadOnlyAccess",
  );
});

test("combines identity values found in different account-menu elements", () => {
  assert.deepEqual(
    extractIdentity([
      "example-production (123456789012)",
      "ReadOnlyAccess/alice",
    ]),
    {
      accountId: "123456789012",
      roleName: "ReadOnlyAccess",
    },
  );
});

test("preserves an AWS Console destination including its fragment", () => {
  const destination =
    "https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/LZ_trusted_advisor_exclude?tab=code";
  const result = buildSsoUrl({
    portalUrl: "https://example.awsapps.com/start",
    accountId: "123456789012",
    roleName: "ReadOnlyAccess",
    destination,
  });

  const query = result.split("#/console?")[1];
  const params = new URLSearchParams(query);

  assert.equal(
    result.startsWith(
      "https://example.awsapps.com/start/#/console?",
    ),
    true,
  );
  assert.equal(params.get("account_id"), "123456789012");
  assert.equal(params.get("role_name"), "ReadOnlyAccess");
  assert.equal(params.get("destination"), destination);
});

test("preserves CloudWatch and S3 URLs", () => {
  const destinations = [
    "https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fexample",
    "https://eu-central-1.console.aws.amazon.com/s3/buckets/example-bucket?region=eu-central-1&bucketType=general&prefix=folder%2F",
  ];

  for (const destination of destinations) {
    const result = buildSsoUrl({
      portalUrl: "https://example.awsapps.com/start",
      accountId: "123456789012",
      roleName: "ReadOnlyAccess",
      destination,
    });
    const params = new URLSearchParams(result.split("#/console?")[1]);
    assert.equal(params.get("destination"), destination);
  }
});

test("rejects non-console destinations", () => {
  assert.throws(
    () =>
      buildSsoUrl({
        portalUrl: "https://example.awsapps.com/start",
        accountId: "123456789012",
        roleName: "ReadOnlyAccess",
        destination: "https://example.com/",
      }),
    /not an AWS Console URL/,
  );
});

test("validates and normalizes access portal URLs", () => {
  assert.equal(
    normalizePortalUrl("https://example.awsapps.com/start/"),
    "https://example.awsapps.com/start",
  );
  assert.throws(
    () => normalizePortalUrl("https://example.com/start"),
    /access portal must look like/,
  );
});
