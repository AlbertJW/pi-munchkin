export function buildCapsule(records) {
	return {
	  project: records.PROJECT_CODE,
	  owner: records.OWNER_ALIAS,
	  checkpoint: records.CHECKPOINT,
	  mode: records.OUTPUT_MODE,
	  rollback: records.ROLLBACK_TOKEN,
	  state: "pending",
	  invariant: records.INVARIANT,
	  next: records.NEXT_ACTION,
	};
}
