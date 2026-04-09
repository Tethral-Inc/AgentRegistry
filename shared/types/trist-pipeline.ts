/**
 * TriST Pipeline Contract
 *
 * Defines the interface between ACR and the TriST (Topological Response
 * Interaction Space Transform) service. ACR sends enriched receipt batches;
 * TriST returns canonical geometric friction profiles.
 *
 * This is a contract definition only — the TriST service is external to ACR.
 */

export interface TriSTReceiptPayload {
  target_system_id: string;
  duration_ms: number;
  queue_wait_ms?: number;
  retry_count?: number;
  error_code?: string;
  status: string;
  chain_id?: string;
  chain_position?: number;
  preceded_by?: string;
  request_timestamp_ms: number;
  response_size_bytes?: number;
}

export interface TriSTRequest {
  agent_id: string;
  window_start: string;
  window_end: string;
  receipts: TriSTReceiptPayload[];
  metadata?: {
    baseline_median_ms?: Record<string, number>;
    population_size?: number;
    provider_class?: string;
  };
}

export interface TriSTDeformationProfile {
  sender_cost: number;
  receiver_cost: number;
  sender_residual: number;
  receiver_residual: number;
  transmission_gap: number;
  directional_asymmetry: number;
  sender_recovery_ratio: number;
  receiver_recovery_ratio: number;
  deformation_magnitude: number;
  deformation_angle: number;
  deformation_ratio: number;
  bucket: string;
  derivation_state: 'derived' | 'partial' | 'suppressed';
  reason_codes: string[];
}

export interface TriSTInteractionShape {
  bucket: string;
  deformation_magnitude: number;
  deformation_angle: number;
  deformation_ratio: number;
  residual_ratio: number;
  source_deformation_vector: number[];
  target_deformation_vector: number[];
  transmission_shape_vector: number[];
}

export interface TriSTResponseGeometry {
  distance_mahalanobis: number;
  drift_ewma: number;
  curvature: number;
  continuity_z: number;
  envelope_depth: number;
  envelope_slack_ratio: number;
  stability_half_life_estimate: number;
  over_consistency_score: number;
  risk_score_0_1: number;
  risk_band_0_3: number;
}

export interface TriSTFrictionSurface {
  interaction_overhead_ms: number;
  pre_post_asymmetry: number;
  queue_wait_ms: number;
  retry_count: number;
  schema_repairs: number;
  branch_count: number;
  candidate_friction_surface_0_1: number;
}

export interface TriSTSignalQualification {
  response_surface_claim: 'unqualified' | 'partial' | 'qualified';
  response_geometry_claim: 'unqualified' | 'partial' | 'qualified';
  friction_deformation_claim: 'unqualified' | 'partial' | 'qualified';
  interaction_shape_claim: 'unqualified' | 'partial' | 'qualified';
  overall_signal_state: 'unqualified' | 'partial' | 'qualified';
}

export interface TriSTResponse {
  agent_id: string;
  window_start: string;
  window_end: string;
  deformation_profile: TriSTDeformationProfile;
  interaction_shape_profile: TriSTInteractionShape;
  response_geometry_profile: TriSTResponseGeometry;
  friction_surface: TriSTFrictionSurface;
  signal_qualification: TriSTSignalQualification;
  computed_at: string;
}

export interface TriSTStoredResult {
  agent_id: string;
  window_date: string;
  trist_response: TriSTResponse;
  stored_at: string;
}
