"""Root-cause analysis: counterfactual decomposition with FDR-controlled evidence."""

from .engine import DimensionScore, RootCauseNode, RootCauseTree, analyse_root_cause

__all__ = ["DimensionScore", "RootCauseNode", "RootCauseTree", "analyse_root_cause"]
