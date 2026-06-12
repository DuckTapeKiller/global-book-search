import { looksLikeBotChallenge } from "@utils/http";

const AWS_WAF_CHALLENGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<script type="text/javascript">
window.awsWafCookieDomainList = [];
window.gokuProps = {"key":"AQIDA...","iv":"D54e...","context":"vBsh..."};
</script>
<script src="https://ea457862827c.token.awswaf.com/challenge.js"></script>
</head>
<body><div id="challenge-container"></div></body>
</html>`;

describe("looksLikeBotChallenge", () => {
  it("flags HTTP 202 regardless of body (Goodreads empty-body block)", () => {
    expect(looksLikeBotChallenge(202, "")).toBe(true);
    expect(looksLikeBotChallenge(202, undefined)).toBe(true);
  });

  it("flags an AWS WAF challenge page served with HTTP 200", () => {
    expect(looksLikeBotChallenge(200, AWS_WAF_CHALLENGE_HTML)).toBe(true);
  });

  it("does not flag a normal HTML page", () => {
    const html =
      '<html><head><title>The Hobbit</title></head><body><h1 data-testid="bookTitle">The Hobbit</h1></body></html>';
    expect(looksLikeBotChallenge(200, html)).toBe(false);
  });

  it("does not flag an empty 200 response", () => {
    expect(looksLikeBotChallenge(200, "")).toBe(false);
  });
});
