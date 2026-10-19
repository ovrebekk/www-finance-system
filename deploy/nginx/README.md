# nginx for finance.ovrebekk.no

The server `ubuntu-immich` already runs nginx with the shared setup used by the
wine organizer and Immich. This app only needs **one new site file**.

| File here | On the server | Status |
| --- | --- | --- |
| `finance` | `/etc/nginx/sites-available/finance` | **New** – install this |
| `snippets/ovrebekk-ssl.conf` | `/etc/nginx/snippets/ovrebekk-ssl.conf` | Exists – reference copy only |
| `snippets/proxy-headers.conf` | `/etc/nginx/snippets/proxy-headers.conf` | Exists – reference copy only |
| `00-default` | `/etc/nginx/sites-available/00-default` | Exists – reference copy only |

The reference copies document what the site file relies on. The versions on
the server are the authoritative ones; do not overwrite them with these.

## Install

```bash
sudo cp deploy/nginx/finance /etc/nginx/sites-available/finance
sudo ln -s /etc/nginx/sites-available/finance /etc/nginx/sites-enabled/finance
sudo nginx -t && sudo systemctl reload nginx
```

No DNS or certificate work is needed: the Domeneshop wildcard `*` A record and
the `*.ovrebekk.no` Let's Encrypt wildcard certificate already cover
`finance.ovrebekk.no`.

## Check

```bash
curl -sI https://finance.ovrebekk.no/api/health   # 200, with the security headers
curl -s  https://finance.ovrebekk.no/api/health   # {"status":"ok"}
```
