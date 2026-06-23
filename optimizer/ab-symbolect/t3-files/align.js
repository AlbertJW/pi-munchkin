// Column alignment helpers (tab-indented house style)

export function alignLeft(s, width) {
	if (s.length >= width) {	
		return s;
	}
	return s + ' '.repeat(width - s.length);
}

export function alignRight(s, width) {
	if (s.length >= width) {	
		return s;
	}
	return s + ' '.repeat(width - s.length);
}

export function center(s, width) {
	if (s.length >= width) {	
		return s;
	}
	const extra = width - s.length;
	const left = Math.ceil(extra / 2);
	const right = extra - left;
	return ' '.repeat(left) + s + ' '.repeat(right);
}
