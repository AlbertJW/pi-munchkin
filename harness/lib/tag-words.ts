// 256 short, common, visually distinct words for slug-encoded hashline tags
// (HASHLINE_TAG=slug): 3 words = 24 bits vs hex's 32. The snapshot store dedupes
// by tag AND text, and stale-tag content relocation catches the rare residual
// collision, so the reduced space trades a negligible risk for copy fidelity —
// small models mangle hex ("#main" invented live) but copy real words reliably.
// Curated: 3-5 letters, no plural/singular pairs, no homophone pairs.
export const TAG_WORDS: string[] = [
	"acorn", "amber", "anvil", "apple", "arrow", "attic", "badge", "bagel",
	"banjo", "barn", "basil", "beach", "bell", "bench", "birch", "bison",
	"blade", "blimp", "bloom", "board", "boot", "bough", "bowl", "brick",
	"brook", "broom", "brush", "cabin", "cable", "cactus", "camel", "candle",
	"canoe", "cape", "cargo", "cedar", "chalk", "chart", "chess", "chime",
	"cider", "clam", "cliff", "cloak", "clock", "cloud", "clove", "coast",
	"cobra", "comet", "coral", "cork", "crane", "crate", "creek", "crow",
	"crumb", "cup", "delta", "denim", "dew", "dome", "door", "drift",
	"drum", "dune", "eagle", "easel", "ember", "fable", "falcon", "fern",
	"ferry", "field", "fig", "flame", "flask", "fleet", "flint", "flute",
	"foam", "fog", "forge", "fox", "frost", "gable", "galley", "gate",
	"gecko", "gem", "glide", "globe", "glove", "gorge", "grain", "grape",
	"grove", "gull", "harbor", "harp", "hatch", "hawk", "hazel", "hearth",
	"hedge", "heron", "hill", "hinge", "hive", "holly", "hook", "horn",
	"husk", "igloo", "inlet", "iris", "ivory", "jade", "jetty", "jug",
	"juniper", "kayak", "kelp", "kettle", "kiln", "kite", "knoll", "ladle",
	"lagoon", "lamp", "lance", "lantern", "larch", "latch", "ledge", "lemon",
	"lily", "linen", "lock", "loft", "log", "loom", "lotus", "lunar",
	"lynx", "mango", "mantle", "maple", "marsh", "mast", "meadow", "melon",
	"mesa", "mill", "mint", "mole", "moss", "moth", "mound", "mural",
	"nest", "north", "nutmeg", "oak", "oasis", "ocean", "olive", "onyx",
	"opal", "orbit", "otter", "owl", "paddle", "pail", "palm", "panda",
	"pear", "pebble", "perch", "pier", "pine", "plank", "plaza", "plum",
	"pond", "poplar", "prism", "quail", "quartz", "quill", "raft", "rain",
	"ranch", "raven", "reef", "ridge", "river", "robin", "rope", "rose",
	"rye", "saddle", "sage", "sail", "salt", "sand", "shale", "shell",
	"shore", "shrub", "silk", "slate", "sleet", "sloop", "smoke", "snow",
	"spade", "spark", "spire", "spruce", "squid", "stone", "stork", "storm",
	"stove", "swan", "syrup", "table", "tarn", "thorn", "tide", "tiger",
	"timber", "torch", "trail", "trout", "tulip", "tundra", "turf", "vale",
	"vault", "velvet", "vine", "violet", "wagon", "walnut", "wave", "wharf",
	"wheat", "willow", "wolf", "wren", "yarn", "yew", "zebra", "zinc",
];

if (TAG_WORDS.length !== 256) throw new Error(`TAG_WORDS must be exactly 256, got ${TAG_WORDS.length}`);
