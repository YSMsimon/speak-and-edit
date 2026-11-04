import { describe, expect, it } from 'vitest';
import { authorizeUrl, collectStream, friendlyError, parseCallback, pkceChallenge, planBody, readIdToken, REDIRECT, RESOURCE, SCOPE } from '../ai/chatgpt';

const sse = (...events: object[]) => new Response(events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

describe('Sign in with ChatGPT: the sign-in request', () => {
  it('first sign-in registers Scribe dynamically, with every parameter the docs list', () => {
    const u = new URL(authorizeUrl({ hostId: 'urn:uuid:1234', challenge: 'CH', state: 'ST', nonce: 'NO' }));
    expect(u.origin + u.pathname).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Scribe',
      ext_agent_host_id: 'urn:uuid:1234',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: 'ST',
      nonce: 'NO',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
    });
    expect(SCOPE).toContain('chatgpt.tokens.use.direct');
    expect(RESOURCE).toBe('https://api.openai.com/v1');
  });

  it('later sign-ins reuse the issued client, drop the name hint, and pass the old ID token as a hint', () => {
    const q = new URL(authorizeUrl({ clientId: 'oaiapp_1', hostId: 'urn:uuid:1234', challenge: 'CH', state: 'ST', nonce: 'NO', idTokenHint: 'old.id.token' })).searchParams;
    expect(q.get('client_id')).toBe('oaiapp_1');
    expect(q.has('agent_name_hint')).toBe(false);
    expect(q.get('id_token_hint')).toBe('old.id.token');
  });

  it('PKCE challenge is base64url SHA-256 without padding', async () => {
    // Cross-checked: printf '%s' <verifier> | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
    expect(await pkceChallenge('dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc');
  });
});

describe('Sign in with ChatGPT: the reply', () => {
  const at = (q: string) => `${REDIRECT}?${q}`;

  it('takes the code and the issued client on a new registration', () => {
    expect(parseCallback(at('code=C1&state=S&client_id=oaiapp_9&scope=openid'), 'S')).toEqual({ code: 'C1', clientId: 'oaiapp_9' });
  });

  it('rejects a reply for a different attempt', () => {
    expect(() => parseCallback(at('code=C1&state=OTHER&client_id=oaiapp_9'), 'S')).toThrow('didn’t match');
  });

  it('says plainly when the user declined', () => {
    expect(() => parseCallback(at('error=access_denied&state=S'), 'S')).toThrow('You didn’t allow Scribe');
  });

  it('treats a new registration without an issued client as incomplete', () => {
    expect(() => parseCallback(at('code=C1&state=S'), 'S')).toThrow('didn’t finish registering');
    expect(() => parseCallback(at('code=C1&state=S&client_id=dynamic_agent_client'), 'S')).toThrow('didn’t finish registering');
  });

  it('keeps the known client on re-sign-in and rejects a different one', () => {
    expect(parseCallback(at('code=C1&state=S'), 'S', 'oaiapp_1')).toEqual({ code: 'C1', clientId: 'oaiapp_1' });
    expect(() => parseCallback(at('code=C1&state=S&client_id=oaiapp_2'), 'S', 'oaiapp_1')).toThrow('different app registration');
  });

  it('reads the email from the ID token after checking audience, nonce and expiry', () => {
    const now = Date.now();
    const good = jwt({ sub: 'user-1', aud: 'oaiapp_1', nonce: 'N', exp: now / 1000 + 600, email: 'simon@example.com' });
    expect(readIdToken(good, { clientId: 'oaiapp_1', nonce: 'N', now })).toEqual({ email: 'simon@example.com', subject: 'user-1' });
    expect(() => readIdToken(good, { clientId: 'oaiapp_2', nonce: 'N', now })).toThrow('different app');
    expect(() => readIdToken(good, { clientId: 'oaiapp_1', nonce: 'X', now })).toThrow('didn’t match');
  });
});

describe('Sign in with ChatGPT: requests', () => {
  it('shapes the body for the plan route: no store, streamed, system text moved to instructions, unsupported fields gone', () => {
    const body = planBody({
      model: 'gpt-6.1-sol',
      input: [
        { role: 'system', content: 'You are Scribe.' },
        { role: 'user', content: [{ type: 'input_text', text: 'add Postgres' }] },
      ],
      temperature: 0,
      max_output_tokens: 500,
      top_p: 1,
      store: true,
      text: { format: { type: 'json_schema', name: 'intent', schema: {} } },
    });
    expect(body).toEqual({
      model: 'gpt-6.1-sol',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'add Postgres' }] }],
      instructions: 'You are Scribe.',
      store: false,
      stream: true,
      text: { format: { type: 'json_schema', name: 'intent', schema: {} } },
    });
  });

  it('keeps developer messages and images as they are', () => {
    const input = [
      { role: 'developer', content: 'Rules' },
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,aGk=' }] },
    ];
    expect(planBody({ model: 'm', input }).input).toEqual(input);
  });

  it('turns the stream back into the finished response', async () => {
    const res = await collectStream(
      sse({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } }, { type: 'response.output_text.delta', delta: '{"a"' }, { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [] } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'r1', status: 'completed', output: [] });
  });

  it('turns a usage-limit failure into a 429 with a readable message', async () => {
    const res = await collectStream(sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('chatgpt.com/settings/usage');
  });

  it('treats a stream that ends without completing as a failure', async () => {
    const res = await collectStream(sse({ type: 'response.output_text.delta', delta: 'hal' }));
    expect(res.status).toBe(502);
  });

  it('names the unsupported part of a request', () => {
    expect(friendlyError('subscription_sharing_unsupported_capability', 'text.format', 'x')).toBe('Your ChatGPT plan can’t do this request (text.format).');
    expect(friendlyError(undefined, undefined, 'raw')).toBe('raw');
  });
});
