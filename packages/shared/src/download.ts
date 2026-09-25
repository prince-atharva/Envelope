/** POST /download/:token/renew (docs/17 step 10). No request body: the token is the credential. */
export interface DownloadRenewResponse {
  renewed: true;
}
