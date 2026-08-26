# AWS SSO Console Link

A Violentmonkey userscript for Chrome and Microsoft Edge that copies the
current AWS Console URL as an IAM Identity Center shortcut.

The generated link sends its recipient through the configured AWS access
portal, selects the account and permission set visible in the AWS Console, and
then returns to the original page. It works with console URLs containing query
strings and fragments, including CloudWatch metrics and logs, Lambda functions,
S3 buckets, and ECS resources.

## Install

1. Install Violentmonkey in Chrome or Microsoft Edge.
2. Open [`aws-sso-console-link.user.js`](aws-sso-console-link.user.js).
3. Select **Raw**. Violentmonkey should open its installation page.
4. Confirm the installation and reload an AWS Console tab.

If the GitHub raw link is not intercepted, open the Violentmonkey
dashboard, create a new script, replace its contents with the userscript, and
save it.

Install the script separately in each browser profile where it is needed.

## Use

Open any AWS Console page and select **Copy SSO link** in the lower-right
corner. The same action is available as **Copy role-safe AWS link** in the
Violentmonkey extension menu.

The script reads values such as:

```text
example-production (123456789012)
ReadOnlyAccess/alice
```

It uses the account ID and `ReadOnlyAccess` permission-set name. The session
user, account alias, and generated `AWSReservedSSO_...` suffix are not included
in the link.

The script only copies a URL. It does not navigate, modify AWS resources, or
grant permissions. Recipients must already be assigned to the detected IAM
Identity Center permission set.

## Configuration

On first use, the script asks for an AWS access portal URL such as
`https://example.awsapps.com/start`. Violentmonkey stores it locally for that
browser profile. Use **Configure AWS access portal** from the Violentmonkey menu
to change it later.

No account IDs, organization names, access portal identifiers, or roles are
included in the source code. The script makes no network requests of its own.

## Test

The tests use Node.js without third-party dependencies:

```bash
node --check aws-sso-console-link.user.js
node --test test/aws-sso-console-link.test.js
```
