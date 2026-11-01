"""Control plane (S4): the playground backend as the operator's single entry point to workcells and policy servers.

It never sends actions. It lists workcells and policy servers, starts episodes on a workcell (choosing the
policy endpoint), relays operator events (reset confirmation, verdicts, stop, e-stop, clearing a fault) and
proxies a workcell's live event stream to the browser.

Roles, by token (`--role-token viewer=... --role-token operator=... --role-token approver=...`):
- viewer:   read everything, and press the e-stop (stopping is never gated behind a higher role);
- operator: start episodes, reset / verdict / stop / clear a fault, live sandbox, jobs;
- approver: everything, plus promote / roll back campaign versions.
Without role tokens (and without --token) the local user has every role.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from hylo.core.remote.workcell import PATHS, OperatorEvent, StartEpisode

ROLES = ("viewer", "operator", "approver")


@dataclass
class Endpoint:
    name: str
    url: str
    token: str | None = None

    @classmethod
    def parse(cls, text: str) -> "Endpoint":
        """name=url or name=url#token"""
        name, _, rest = text.partition("=")
        url, _, token = rest.partition("#")
        if not name or not url:
            raise ValueError(f"expected name=url[#token], got {text!r}")
        return cls(name.strip(), url.strip().rstrip("/"), token.strip() or None)


class Roles:
    def __init__(self, tokens: dict[str, str] | None = None, legacy: str | None = None) -> None:
        self.by_token = {t: r for r, t in (tokens or {}).items()}
        if legacy:
            self.by_token[legacy] = "approver"
        self.open = not self.by_token

    def role(self, token: str | None) -> str | None:
        if self.open:
            return "approver"
        return self.by_token.get(token or "")

    @staticmethod
    def allows(role: str | None, needed: str) -> bool:
        return role is not None and ROLES.index(role) >= ROLES.index(needed)


class ControlPlane:
    def __init__(self, workcells: list[Endpoint], policies: list[Endpoint], timeout_s: float = 3.0) -> None:
        self.workcells = {w.name: w for w in workcells}
        self.policies = {p.name: p for p in policies}
        self.timeout_s = timeout_s

    def _http(self, ep: Endpoint, path: str, body: dict[str, Any] | None = None) -> Any:
        headers = {"content-type": "application/json"}
        if ep.token:
            headers["authorization"] = f"Bearer {ep.token}"
        req = urllib.request.Request(ep.url + path, data=None if body is None else json.dumps(body).encode(), headers=headers,
                                     method="GET" if body is None else "POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except ValueError:
                pass
            raise RuntimeError(f"{ep.name}: {detail}") from exc

    def workcell(self, name: str) -> Endpoint:
        if name not in self.workcells:
            raise KeyError(f"unknown workcell {name!r}")
        return self.workcells[name]

    def list_workcells(self) -> list[dict[str, Any]]:
        out = []
        for w in self.workcells.values():
            try:
                out.append({"name": w.name, "url": w.url, "reachable": True, "status": self._http(w, PATHS["status"])})
            except Exception as exc:  # noqa: BLE001 - an unreachable workcell is a status, not an error
                out.append({"name": w.name, "url": w.url, "reachable": False, "error": str(exc)[:200]})
        return out

    def list_policies(self) -> list[dict[str, Any]]:
        out = []
        for p in self.policies.values():
            http = p.url.replace("ws://", "http://").replace("wss://", "https://")
            base = http.rsplit("/", 1)[0] if http.endswith(("/hylo", "/wc", "/openpi")) else http
            try:
                meta = self._http(Endpoint(p.name, base, p.token), "/meta")
                out.append({"name": p.name, "url": p.url, "reachable": True, "agent": meta.get("agent", {}).get("name"),
                            "version": meta.get("version"), "components": meta.get("agent", {}).get("components")})
            except Exception as exc:  # noqa: BLE001
                out.append({"name": p.name, "url": p.url, "reachable": False, "error": str(exc)[:200]})
        return out

    def start(self, name: str, body: dict[str, Any]) -> Any:
        body = dict(body)
        if isinstance(body.get("policy"), str):                     # a policy chosen by name
            p = self.policies[body["policy"]]
            body["policy"] = {"url": p.url, "token": p.token, "protocol": "openpi" if p.url.endswith("/openpi") else "hylo"}
        req = StartEpisode.model_validate(body)                     # hylo.workcell/v0.1 (core.remote.workcell)
        return self._http(self.workcell(name), PATHS["episodes"], req.model_dump(mode="json", exclude_none=True))

    def operator(self, name: str, event: dict[str, Any]) -> Any:
        ev = OperatorEvent.model_validate(event)
        return self._http(self.workcell(name), PATHS["operator"], ev.model_dump(mode="json", exclude_none=True))

    def events_url(self, name: str) -> str:
        w = self.workcell(name)
        url = w.url.replace("http://", "ws://").replace("https://", "wss://") + PATHS["events"]
        return url + (f"?token={w.token}" if w.token else "")
