export function onRequest(context) {
  const iconUrl = new URL("/assets/icons/favicon.ico", context.request.url);
  return Response.redirect(iconUrl.toString(), 302);
}
