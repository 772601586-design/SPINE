"""Network availability only; never changes clinical verification status."""
import ipaddress
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

TRUSTED_HOSTS = {'www.srs.org', 'srs.org', 'etext.srs.org', 'www.niams.nih.gov', 'niams.nih.gov',
                 'pmc.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'doi.org', 'www.cochranelibrary.com',
                 'www.cochrane.org', 'www.nejm.org', 'link.springer.com', 'scoliosisjournal.biomedcentral.com',
                 'bmcmusculoskeletdisord.biomedcentral.com'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_url(url):
    p = urlparse(url)
    if p.scheme != 'https' or p.hostname not in TRUSTED_HOSTS or p.port not in (None, 443) or p.username or p.password:
        return False
    return all(ipaddress.ip_address(item[4][0]).is_global for item in socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM))


def check_link(url):
    opener = build_opener(NoRedirect())
    try:
        for _ in range(4):
            if not safe_url(url):
                return 'manual_check_required'
            try:
                with opener.open(Request(url, headers={'User-Agent': 'Scolio-Source-Link-Check/1.0'}), timeout=8) as response:
                    sample = response.read(4096).lower()
                    return 'challenge_page' if b'captcha' in sample or b'checking your browser' in sample else 'ok'
            except HTTPError as exc:
                if exc.code in (301, 302, 303, 307, 308):
                    url = urljoin(url, exc.headers.get('Location', ''))
                    continue
                return 'http_' + str(exc.code)
        return 'redirect_limit'
    except (URLError, OSError, ValueError):
        return 'network_error'
