/** Reset halaman: `page` dihapus, `per_page` tidak disentuh. */
function resetPage(url: URL): void {
	url.searchParams.delete('page');
}

/** Salin `url`, set `key=value` (hapus param bila value kosong), lalu reset halaman (hapus `page`). */
export function setFilter(url: URL, key: string, value: string): URL {
	const next = new URL(url.toString());
	const trimmed = value.trim();
	if (trimmed === '') {
		next.searchParams.delete(key);
	} else {
		next.searchParams.set(key, trimmed);
	}
	resetPage(next);
	return next;
}

/** Salin `url`, hapus semua `keys`, reset `page`. */
export function resetFilters(url: URL, keys: string[]): URL {
	const next = new URL(url.toString());
	for (const key of keys) {
		next.searchParams.delete(key);
	}
	resetPage(next);
	return next;
}

/** Berapa banyak `keys` yang punya nilai non-kosong di `url`. */
export function countActiveFilters(url: URL, keys: string[]): number {
	return keys.filter((key) => url.searchParams.getAll(key).some((value) => value.trim() !== ''))
		.length;
}
