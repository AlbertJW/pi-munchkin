export type ContextAdmissionScreenCell = {
	exit_code: number;
	forwarded_requests: number;
	telemetry: { present: boolean; outcome: string | null; reason_class: string | null };
};

/**
 * A forwarded request only proves pre-dispatch exposure.  The normal cell must
 * also complete successfully; otherwise an upstream/provider failure could be
 * misreported as a qualified safety screen.
 */
export function evaluateContextAdmissionScreen(
	normal: ContextAdmissionScreenCell,
	oversize: ContextAdmissionScreenCell,
	required: {
		normal_outcome: string;
		oversize_outcome: string;
		oversize_reason: string;
		normal_forwarded_requests: number;
		oversize_forwarded_requests: number;
	},
): { normal_exposed: boolean; oversize_blocked_pre_dispatch: boolean; passed: boolean } {
	const normal_exposed = normal.exit_code === 0
		&& normal.telemetry.present
		&& normal.telemetry.outcome === required.normal_outcome
		&& normal.forwarded_requests === required.normal_forwarded_requests;
	const oversize_blocked_pre_dispatch = oversize.telemetry.present
		&& oversize.telemetry.outcome === required.oversize_outcome
		&& oversize.telemetry.reason_class === required.oversize_reason
		&& oversize.forwarded_requests === required.oversize_forwarded_requests;
	return { normal_exposed, oversize_blocked_pre_dispatch, passed: normal_exposed && oversize_blocked_pre_dispatch };
}
