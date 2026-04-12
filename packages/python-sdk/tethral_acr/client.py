"""ACR Python SDK - lightweight REST wrapper for the Agent Composition Records network."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

import httpx


class ACRError(Exception):
    """Error returned by the ACR API."""

    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class ACRClient:
    """Client for the ACR (Agent Composition Records) API.

    Usage:
        client = ACRClient()
        result = client.register(public_key="...", provider_class="anthropic")
        client.submit_receipt(receipt={...})
        report = client.get_friction_report(agent_id="acr_xxx", scope="day")
    """

    def __init__(
        self,
        api_url: str | None = None,
        resolver_url: str | None = None,
        timeout: float = 30.0,
    ):
        self.api_url = api_url or os.environ.get("ACR_API_URL", "https://acr.nfkey.ai")
        self.resolver_url = resolver_url or self.api_url
        self._client = httpx.Client(timeout=timeout)

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        res = self._client.post(
            f"{self.api_url}{path}",
            json=body,
            headers={"Content-Type": "application/json"},
        )
        data = res.json()
        if not res.is_success:
            error = data.get("error", {})
            raise ACRError(
                error.get("code", "UNKNOWN"),
                error.get("message", "Request failed"),
                res.status_code,
            )
        return data

    def _get(self, path: str, use_resolver: bool = False) -> Any:
        base = self.resolver_url if use_resolver else self.api_url
        res = self._client.get(f"{base}{path}")
        data = res.json()
        if not res.is_success:
            error = data.get("error", {})
            raise ACRError(
                error.get("code", "UNKNOWN"),
                error.get("message", "Request failed"),
                res.status_code,
            )
        return data

    def register(
        self,
        public_key: str,
        provider_class: str,
        skills: list[str] | None = None,
        skill_hashes: list[str] | None = None,
        operational_domain: str | None = None,
    ) -> dict[str, Any]:
        """Register an agent with the ACR network."""
        body: dict[str, Any] = {
            "public_key": public_key,
            "provider_class": provider_class,
        }
        if skills or skill_hashes:
            body["composition"] = {"skills": skills, "skill_hashes": skill_hashes}
        if operational_domain:
            body["operational_domain"] = operational_domain
        return self._post("/api/v1/register", body)

    def submit_receipt(self, receipt: dict[str, Any]) -> dict[str, Any]:
        """Submit a single interaction receipt."""
        return self._post("/api/v1/receipts", receipt)

    def submit_receipts(self, receipts: list[dict[str, Any]]) -> dict[str, Any]:
        """Submit a batch of interaction receipts (max 50)."""
        return self._post("/api/v1/receipts", {"receipts": receipts})

    def submit_receipt_with_chain(self, receipt: dict, chain_id: str = None,
                                  chain_position: int = None, preceded_by: str = None) -> dict:
        """Submit an interaction receipt with optional chain tracking."""
        if chain_id is not None:
            receipt["chain_id"] = chain_id
        if chain_position is not None:
            receipt["chain_position"] = chain_position
        if preceded_by is not None:
            receipt["preceded_by"] = preceded_by
        return self._post("/api/v1/receipts", receipt)

    def submit_receipt_with_categories(
        self,
        receipt: dict,
        target_type: str | None = None,
        activity_class: str | None = None,
        interaction_purpose: str | None = None,
        workflow_role: str | None = None,
        workflow_phase: str | None = None,
        data_shape: str | None = None,
        criticality: str | None = None,
        **extra_categories: str,
    ) -> dict:
        """Submit an interaction receipt with descriptive classification.

        All category fields are optional and content-free. Unknown dimensions
        passed via ``extra_categories`` are accepted — the taxonomy is
        expected to evolve.

        Example::

            client.submit_receipt_with_categories(
                receipt={...},
                activity_class="math",
                interaction_purpose="generate",
                criticality="core",
            )
        """
        categories: dict[str, str] = {}
        if target_type:
            categories["target_type"] = target_type
        if activity_class:
            categories["activity_class"] = activity_class
        if interaction_purpose:
            categories["interaction_purpose"] = interaction_purpose
        if workflow_role:
            categories["workflow_role"] = workflow_role
        if workflow_phase:
            categories["workflow_phase"] = workflow_phase
        if data_shape:
            categories["data_shape"] = data_shape
        if criticality:
            categories["criticality"] = criticality
        for key, value in extra_categories.items():
            if value:
                categories[key] = value
        if categories:
            receipt["categories"] = {**receipt.get("categories", {}), **categories}
        return self._post("/api/v1/receipts", receipt)

    def update_composition(
        self,
        agent_id: str,
        skills: list[str] | None = None,
        skill_hashes: list[str] | None = None,
    ) -> dict[str, Any]:
        """Update an agent's composition snapshot."""
        return self._post(
            "/api/v1/composition/update",
            {"agent_id": agent_id, "composition": {"skills": skills, "skill_hashes": skill_hashes}},
        )

    def check_skill(self, skill_hash: str) -> dict[str, Any]:
        """Check a skill hash against the ACR network."""
        return self._get(f"/v1/skill/{skill_hash}", use_resolver=True)

    def check_agent(self, agent_id: str) -> dict[str, Any]:
        """Look up an agent by ID."""
        return self._get(f"/v1/agent/{agent_id}", use_resolver=True)

    def get_system_health(self, system_id: str) -> dict[str, Any]:
        """Get raw signal rates for a target system."""
        return self._get(f"/v1/system/{system_id}/health", use_resolver=True)

    def get_active_signals(self) -> list[dict[str, Any]]:
        """Get skills with elevated anomaly signals."""
        return self._get("/v1/threats/active", use_resolver=True)

    def get_friction_report(
        self, agent_id: str, scope: str = "day"
    ) -> dict[str, Any]:
        """Get a friction analysis report for an agent."""
        return self._get(f"/api/v1/agent/{agent_id}/friction?scope={scope}")

    def health(self) -> dict[str, Any]:
        """Check API health."""
        return self._get("/api/v1/health")

    def search_skills(
        self,
        query: str,
        source: str | None = None,
        category: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Search the skill catalog."""
        params: dict[str, str] = {"q": query, "limit": str(limit), "offset": str(offset)}
        if source:
            params["source"] = source
        if category:
            params["category"] = category
        return self._get(f"/api/v1/skill-catalog/search?{urlencode(params)}")

    def get_skill_catalog(self, skill_id: str) -> dict[str, Any]:
        """Get a single skill detail with version history."""
        return self._get(f"/api/v1/skill-catalog/{skill_id}")

    def get_skill_versions(self, skill_id: str) -> dict[str, Any]:
        """Get complete version history for a skill."""
        return self._get(f"/api/v1/skill-catalog/{skill_id}/versions")

    def get_skill_changes(self, since: str | None = None) -> dict[str, Any]:
        """Get recent skill changes feed."""
        params: dict[str, str] = {}
        if since:
            params["since"] = since
        qs = f"?{urlencode(params)}" if params else ""
        return self._get(f"/api/v1/skill-catalog/changes{qs}")

    def get_crawl_sources(self) -> dict[str, Any]:
        """List crawl sources with status."""
        return self._get("/api/v1/skill-catalog/sources")

    def get_subscriptions(self, agent_id: str) -> dict:
        return self._get(f"/api/v1/agent/{agent_id}/subscriptions")

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self) -> ACRClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
