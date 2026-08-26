# AWS SSO Console Link

A Violentmonkey userscript for Chrome and Microsoft Edge that adds SSO-enabled
companion links to AWS Console pages.

The generated link sends its recipient through the configured AWS access
portal, selects the account and permission set visible in the AWS Console, and
then returns to the original page. It works with console URLs containing query
strings and fragments, including CloudWatch metrics and logs, Lambda functions,
S3 buckets, and ECS resources.

## Install

1. Install Violentmonkey:
   - [Google Chrome — Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
   - [Microsoft Edge — Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
     (enable **Allow extensions from other stores** in `edge://extensions`)
2. Open [`aws-sso-console-link.user.js`](aws-sso-console-link.user.js).
3. Select **Raw**. Violentmonkey should open its installation page.
4. Confirm the installation and reload an AWS Console tab.

If the GitHub raw link is not intercepted, open the Violentmonkey
dashboard, create a new script, replace its contents with the userscript, and
save it.

Install the script separately in each browser profile where it is needed.

## Use

The script leaves existing AWS links unchanged and adds a small **SSO** link
beside eligible links in the page content. For example:

```text
/aws/lambda/example-function  SSO
```

Use the original link for normal navigation. Hover over the adjacent **SSO**
link to inspect its destination, right-click it and select the browser's native
**Copy link** action, or select it normally to open it through IAM Identity
Center in a new tab.

This works for links added dynamically by AWS and for services rendered inside
same-origin AWS console frames, including CloudWatch log groups and streams. It
also applies to console resource links in services such as S3, Lambda, and ECS.

For the current page itself, use **SSO link** beside the account selector in the
top navigation bar:

- Hover over it to prepare the SSO-enabled URL for the current page.
- Right-click it and use the browser's native **Copy link** action.
- Select it normally to open the SSO-enabled URL in a new tab.

You can also select **Copy SSO link for current page** from the Violentmonkey
toolbar menu or press **Alt+Shift+S**. A short confirmation appears after the
URL has been copied.

Destinations are detected automatically. You never need to copy or enter a
CloudWatch, Lambda, S3, or other AWS Console URL yourself. Generated shortcuts
preserve query strings and `#` fragments.

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

## Why it works

A normal AWS Console URL identifies a service page and region, but it does not
identify the AWS account or permission set that should open it. AWS therefore
uses whichever console session the recipient currently has active, which can
show the wrong resource, an empty page, or an access-denied message.

The script turns the current URL into an IAM Identity Center console shortcut:

```text
AWS access portal
  → select account_id
  → select role_name
  → open the URL-encoded destination
```

It performs these steps locally in the browser:

1. Reads the 12-digit account ID from the AWS account menu.
2. Extracts the permission-set name from `RoleName/session-user` or the
   generated `AWSReservedSSO_...` role name.
3. Takes the complete current URL, including query parameters and `#` fragment.
4. URL-encodes it as the shortcut's `destination` parameter.
5. Copies the result to the clipboard.

No credentials or session tokens are included in the generated URL.

## Browser address bar limitation

Violentmonkey scripts run inside web pages. Chrome and Edge do not allow them to
change the browser address bar or add an item next to the address bar's native
**Copy** action. The script therefore inserts real hyperlinks in the AWS page
content and top navigation bar. Their destinations appear on hover and the
browser's native **Copy link** action works on them.

## URL examples

The examples below use AWS documentation-style placeholder values.

### Lambda function

Before:

```text
https://eu-central-1.console.aws.amazon.com/lambda/home?region=eu-central-1#/functions/example-function?tab=code
```

After:

```text
https://example.awsapps.com/start/#/console?account_id=123456789012&role_name=ReadOnlyAccess&destination=https%3A%2F%2Feu-central-1.console.aws.amazon.com%2Flambda%2Fhome%3Fregion%3Deu-central-1%23%2Ffunctions%2Fexample-function%3Ftab%3Dcode
```

### CloudWatch Logs log group

Before:

```text
https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fexample-function
```

After:

```text
https://example.awsapps.com/start/#/console?account_id=123456789012&role_name=ReadOnlyAccess&destination=https%3A%2F%2Feu-central-1.console.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Deu-central-1%23logsV2%3Alog-groups%2Flog-group%2F%24252Faws%24252Flambda%24252Fexample-function
```

### S3 prefix

Before:

```text
https://eu-central-1.console.aws.amazon.com/s3/buckets/example-bucket?region=eu-central-1&bucketType=general&prefix=reports%2F
```

After:

```text
https://example.awsapps.com/start/#/console?account_id=123456789012&role_name=ReadOnlyAccess&destination=https%3A%2F%2Feu-central-1.console.aws.amazon.com%2Fs3%2Fbuckets%2Fexample-bucket%3Fregion%3Deu-central-1%26bucketType%3Dgeneral%26prefix%3Dreports%252F
```

## Configuration

The script remembers the portal URL automatically whenever you visit an AWS
access portal page such as `https://example.awsapps.com/start`. Visit the portal
once in each browser profile, then reload the AWS Console page.

If the portal has not been detected, selecting the in-page link prompts only
for that access portal URL—not for the current Console page URL. You can also
use **Configure AWS access portal** from the Violentmonkey menu.

No account IDs, organization names, access portal identifiers, or roles are
included in the source code. The script makes no network requests of its own.

## Test

The tests use Node.js without third-party dependencies:

```bash
node --check aws-sso-console-link.user.js
node --test test/aws-sso-console-link.test.js
```
