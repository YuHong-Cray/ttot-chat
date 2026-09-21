/**
 * T-to-T HTTP API client (Bearer-token auth). Thin typed wrappers over
 * fetch against the chat server; errors surface as {error} objects the
 * tool layer turns into plain-text diagnostics.
 */

export class ChatAPI {
  /** @param {string} base - e.g. http://127.0.0.1:3000 */
  constructor(base) {
    this.base = base
  }

  /**
   * One API call.
   * @returns {Promise<{status: number, body: any}>}
   */
  async call(token, method, p, body) {
    const headers = { 'content-type': 'application/json' }
    if (token) headers.authorization = 'Bearer ' + token
    const res = await fetch(this.base + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let parsed = null
    try { parsed = await res.json() } catch { parsed = null }
    return { status: res.status, body: parsed }
  }

  /** POST /api/sms/send-code. In mock (dev) mode the response carries the code. */
  async sendCode(phone) {
    const r = await this.call(null, 'POST', '/api/sms/send-code', { phone })
    if (r.status !== 200) throw new Error('send-code failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body // { success, message, code? }
  }

  /** Register with phone + SMS code + password; returns { token, username, role }. */
  async register(phone, code, password) {
    const r = await this.call(null, 'POST', '/api/register', { phone, code, password })
    if (r.status !== 200) throw new Error('register failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }

  /** Login with username (phone or name) + password. */
  async login(username, password) {
    const r = await this.call(null, 'POST', '/api/login', { username, password })
    if (r.status !== 200) throw new Error('login failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }

  /** GET /api/admin/users (admin only). */
  async listUsers(token) {
    const r = await this.call(token, 'GET', '/api/admin/users')
    if (r.status !== 200) throw new Error('list users failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }

  /** GET /api/friends/statuses. */
  async friendStatuses(token) {
    const r = await this.call(token, 'GET', '/api/friends/statuses')
    if (r.status !== 200) throw new Error('friend statuses failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }

  /** POST /api/friends/request { targetUserId }. */
  async addFriend(token, targetUserId) {
    const r = await this.call(token, 'POST', '/api/friends/request', { targetUserId })
    if (r.status !== 200) throw new Error('add friend failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }

  /** POST /api/friends/respond { requestId, accept }. */
  async respondFriend(token, requestId, accept) {
    const r = await this.call(token, 'POST', '/api/friends/respond', { requestId, accept })
    if (r.status !== 200) throw new Error('respond friend failed (' + r.status + '): ' + (r.body && r.body.error ? r.body.error : JSON.stringify(r.body)))
    return r.body
  }
}
