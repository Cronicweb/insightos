// InsightOS — AnalystFacade (§18). The SINGLE orchestration layer the UI talks to.
// No UI component coordinates providers, semantic parsing, grounding, caching, SQL, or explanation
// logic directly. This facade owns the full lifecycle and is safe when AI is disabled.
//
// Lifecycle: Dataset → Semantic Cache → Context → Provider → Grounding Validation
//            → Response Validation → Investigation Graph → Answer Cache → UI

import { ask as facadeAsk } from './analyst';
import {
  createGraph,
  addNode,
  setResponse,
  compareNodes,
  exportGraph,
  type InvestigationGraph,
  type InvestigationResponse,
} from './investigation/graph';
import { setBookmark } from './investigation/bookmarks';
import {
  getCachedSemanticModel,
  setCachedSemanticModel,
  hasCachedSemanticModel,
} from './semantic/cache';
import { buildSemanticModel, draftToProposals, requiresReview, type SemanticModel } from './semantic/model';
import { validateResponse, deterministicFallback } from './validation';
import {
  compareNodesDetailed,
  compareSemantic,
  comparePeriods,
  compareSql,
  compareRecommendations,
  type CompareResult,
} from './compare';
import { planReplay, serializeInvestigation, type SerializedInvestigation } from './replay';
import { loadAISettings } from './settings';
import type { ContextFocus, GroundedContext, SemanticModelDraft, SemanticMappingProposal } from './types';

export interface SemanticReadyState {
  model?: SemanticModel;
  needsReview: boolean;
  proposals: SemanticMappingProposal[];
  fromCache: boolean;
}

export interface InvestigationSeed {
  analysisKey: string;
  question: string;
  focus?: ContextFocus;
}

/**
 * The single orchestration layer. Construct once per analysis/session and route all AI-related
 * UI interactions through it.
 */
export class AnalystFacade {
  private graph: InvestigationGraph | null = null;

  constructor(private readonly analysisKey: string) {}

  /**
   * Ensure a semantic model exists for this dataset WITHOUT re-parsing (§19 parse-once).
   * If cached, returns it directly. Otherwise turns an advisory draft into proposals and reports
   * whether user review is required (confidence gate §14.4). The caller applies review, then calls
   * commitSemanticModel().
   */
  ensureSemanticModel(draft?: SemanticModelDraft): SemanticReadyState {
    const cached = getCachedSemanticModel(this.analysisKey);
    if (cached) {
      return { model: cached, needsReview: false, proposals: [], fromCache: true };
    }
    if (!draft) {
      return { needsReview: false, proposals: [], fromCache: false };
    }
    const proposals = draftToProposals(draft);
    if (requiresReview(proposals)) {
      return { needsReview: true, proposals, fromCache: false };
    }
    const model = buildSemanticModel(this.analysisKey, proposals, { domainHint: draft.domainHint });
    setCachedSemanticModel(model);
    return { model, needsReview: false, proposals, fromCache: false };
  }

  /** Persist the (possibly user-reviewed) semantic model to the session cache (§14.4 / §19). */
  commitSemanticModel(proposals: SemanticMappingProposal[], domainHint?: string): SemanticModel {
    const model = buildSemanticModel(this.analysisKey, proposals, { domainHint });
    setCachedSemanticModel(model);
    return model;
  }

  hasSemanticModel(): boolean {
    return hasCachedSemanticModel(this.analysisKey);
  }

  /** Start (or reset) the investigation graph. */
  startInvestigation(seed: InvestigationSeed): InvestigationGraph {
    const semantic = getCachedSemanticModel(this.analysisKey);
    this.graph = createGraph(
      seed.analysisKey,
      { question: seed.question, focus: seed.focus ?? { kind: 'report' } },
      semantic?.version,
    );
    return this.graph;
  }

  getGraph(): InvestigationGraph | null {
    return this.graph;
  }

  branch(nodeId: string, question: string, focus?: ContextFocus): { graph: InvestigationGraph; nodeId: string } {
    if (!this.graph) throw new Error('No active investigation.');
    const res = addNode(this.graph, nodeId, { question, focus: focus ?? { kind: 'question', text: question } });
    this.graph = res.graph;
    return res;
  }

  bookmark(nodeId: string, on: boolean): InvestigationGraph {
    if (!this.graph) throw new Error('No active investigation.');
    this.graph = setBookmark(this.graph, nodeId, on);
    return this.graph;
  }

  /**
   * Full ask lifecycle: build/resolve context via the analyst facade (provider + cache + trace),
   * VALIDATE the response, fall back deterministically on any violation, then attach to the graph node.
   */
  async ask(
    nodeId: string,
    question: string,
    context: GroundedContext,
    opts: { supportingCharts?: string[]; statisticalTests?: string[]; knownColumns?: string[] } = {},
  ): Promise<InvestigationResponse> {
    if (!this.graph) throw new Error('No active investigation.');
    const settings = loadAISettings();

    let response = await facadeAsk({
      analysisKey: this.analysisKey,
      question,
      context,
      supportingCharts: opts.supportingCharts,
      statisticalTests: opts.statisticalTests,
    });

    // §22: validate before rendering; on any violation, use deterministic fallback.
    const verdict = validateResponse(response, context, {
      strict: settings.strictGrounding,
      knownColumns: opts.knownColumns,
    });
    if (!verdict.ok) {
      response = deterministicFallback(question, context);
    }

    this.graph = setResponse(this.graph, nodeId, response);
    return response;
  }

  /** Type-aware comparison (§21). */
  compare(
    kind: 'node' | 'sql' | 'recommendations',
    a: unknown,
    b: unknown,
  ): CompareResult {
    if (!this.graph && kind === 'node') throw new Error('No active investigation.');
    switch (kind) {
      case 'node': {
        const na = this.graph!.nodes[a as string];
        const nb = this.graph!.nodes[b as string];
        return compareNodesDetailed(na, nb);
      }
      case 'sql':
        return compareSql(a as string, b as string);
      case 'recommendations':
        return compareRecommendations(a as string[], b as string[]);
      default:
        throw new Error(`Unsupported compare kind: ${kind}`);
    }
  }

  exportInvestigation(): string {
    if (!this.graph) throw new Error('No active investigation.');
    return exportGraph(this.graph);
  }

  /** Serialize the current investigation as a portable, concept-based workflow (§26). */
  serialize(conceptsForNode?: Parameters<typeof serializeInvestigation>[1]): SerializedInvestigation {
    if (!this.graph) throw new Error('No active investigation.');
    return serializeInvestigation(this.graph, conceptsForNode);
  }

  /** Plan a Decision Replay against THIS dataset's (new) semantic model (§26). */
  planReplay(serialized: SerializedInvestigation): { reboundSql: Array<{ question: string; sql?: string }>; unmapped: string[] } {
    const model = getCachedSemanticModel(this.analysisKey);
    if (!model) throw new Error('No semantic model for this dataset; ensureSemanticModel first.');
    return planReplay(serialized, model);
  }
}

// Re-export comparison helpers not otherwise reached through the class API surface.
export { compareSemantic, comparePeriods, compareNodes };
