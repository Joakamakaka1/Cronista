/**
 * Source of the viewer-request CloudFront Function (`cloudfront-js-2.0`) that serves the app's page
 * for its routes, such as `/capitulos/2026-11-09`, which are not files in the site bucket.
 *
 * @remarks
 * Only a path whose last segment has no extension is rewritten, so a missing asset is still a 404
 * and never a page. It runs on the site's behaviour only: error responses would do the same for the
 * whole distribution and replace the API's own errors.
 */
export const appRoutesFunctionCode = `function handler(event) {
  var request = event.request;
  var last = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`;
