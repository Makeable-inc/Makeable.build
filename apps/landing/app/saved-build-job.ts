// The build job saved in this browser belongs to the account that started it.
// It reopens only once a signed-in account is confirmed, so an expired session
// still shows the public page, and it is forgotten when the server refuses it
// (another account's job, or gone), so the next person who signs in here is not
// stuck on it.
export function savedBuildJobToResume(savedJobId: string, signedIn: boolean) {
  return signedIn ? savedJobId : "";
}

export function savedBuildJobRefused(status: number) {
  return status === 403 || status === 404;
}
