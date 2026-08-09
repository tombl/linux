/* Shared charset table types (charsets.c + charsets-data.c). */
#ifndef LINKS_CHARSETS_DATA_H
#define LINKS_CHARSETS_DATA_H

struct table_entry {
	unsigned char c;
	int u;
};

struct codepage_desc {
	const char *name;
	const char * const *aliases;
	const struct table_entry *table;
};

struct unicode_7b_entry {
	int x;
	char *s;
};

struct entity_entry {
	const char *s;
	int c;
};

struct case_map_entry {
	unsigned short o;
	unsigned short n;
};

/* Sized externs so array_elements() works from charsets.c. */
extern struct codepage_desc codepages[];
extern struct unicode_7b_entry unicode_7b[2341];
extern struct entity_entry entities[1010];
extern struct case_map_entry unicode_upcase[1133];
extern struct case_map_entry unicode_locase[1111];

#define N_UNICODE_7B 2340
#define N_ENTITIES 1009

#endif
