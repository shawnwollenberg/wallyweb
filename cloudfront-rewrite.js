function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // /foo/  → /foo/index.html
    if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    }
    // /foo   → /foo/index.html   (no extension, no trailing slash)
    else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        request.uri = uri + '/index.html';
    }

    return request;
}
