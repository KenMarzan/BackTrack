"""
Auto-configuration for Backtrack agent.
Detects Docker vs Kubernetes mode and reads all settings from environment variables.
"""
import os
import logging

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("backtrack.config")

K8S_SERVICE_ACCOUNT_PATH = "/var/run/secrets/kubernetes.io/serviceaccount"


class BacktrackConfig:
    """Reads all configuration from environment variables. Zero hardcoded values."""

    def __init__(self) -> None:
        self.target: str = os.getenv("BACKTRACK_TARGET", "")
        self.k8s_namespace: str = os.getenv("BACKTRACK_K8S_NAMESPACE", "default")
        self.k8s_label_selector: str = os.getenv("BACKTRACK_K8S_LABEL_SELECTOR", "")
        self.tsd_iqr_multiplier: float = float(os.getenv("BACKTRACK_TSD_IQR_MULTIPLIER", "3.0"))
        self.lsi_score_multiplier: float = float(os.getenv("BACKTRACK_LSI_SCORE_MULTIPLIER", "2.0"))
        self.scrape_interval: int = int(os.getenv("BACKTRACK_SCRAPE_INTERVAL", "10"))
        self.rollback_enabled: bool = os.getenv("BACKTRACK_ROLLBACK_ENABLED", "true").lower() == "true"
        self.image_tag: str = os.getenv("BACKTRACK_IMAGE_TAG", "unknown")

    @property
    def mode(self) -> str:
        """Returns 'kubernetes' if forced via env var or running inside a K8s pod, else 'docker'."""
        forced = os.getenv("BACKTRACK_MODE", "").lower()
        if forced in ("kubernetes", "k8s"):
            return "kubernetes"
        if os.path.exists(K8S_SERVICE_ACCOUNT_PATH):
            return "kubernetes"
        return "docker"

    def validate(self) -> None:
        """Raises ValueError if no target is configured."""
        if not self.target and not self.k8s_label_selector:
            raise ValueError(
                "No target configured. Set BACKTRACK_TARGET (Docker container name) "
                "or BACKTRACK_K8S_LABEL_SELECTOR (Kubernetes label selector). "
                "Example: BACKTRACK_TARGET=my-app or BACKTRACK_K8S_LABEL_SELECTOR=app=my-app"
            )

    def log_startup_summary(self) -> None:
        """Print a clear startup table to stdout."""
        border = "=" * 55
        logger.info(border)
        logger.info("  BACKTRACK AGENT — CONFIGURATION SUMMARY")
        logger.info(border)
        logger.info("  Mode:                %s", self.mode)
        logger.info("  Target:              %s", self.target or "(not set)")
        logger.info("  K8s Namespace:       %s", self.k8s_namespace)
        logger.info("  K8s Label Selector:  %s", self.k8s_label_selector or "(not set)")
        logger.info("  Scrape Interval:     %ds", self.scrape_interval)
        logger.info("  TSD IQR Multiplier:  %.1f", self.tsd_iqr_multiplier)
        logger.info("  LSI Score Multiplier:%.1f", self.lsi_score_multiplier)
        logger.info("  Rollback Enabled:    %s", self.rollback_enabled)
        logger.info("  Image Tag:           %s", self.image_tag)
        logger.info(border)

    def to_dict(self) -> dict:
        """Serialise config for the /config endpoint."""
        return {
            "mode": self.mode,
            "target": self.target,
            "k8s_namespace": self.k8s_namespace,
            "k8s_label_selector": self.k8s_label_selector,
            "scrape_interval": self.scrape_interval,
            "tsd_iqr_multiplier": self.tsd_iqr_multiplier,
            "lsi_score_multiplier": self.lsi_score_multiplier,
            "rollback_enabled": self.rollback_enabled,
            "image_tag": self.image_tag,
        }


# Module-level singleton
config = BacktrackConfig()
