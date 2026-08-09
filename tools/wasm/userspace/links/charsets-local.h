#ifndef LINKS_CHARSETS_LOCAL_H
#define LINKS_CHARSETS_LOCAL_H

extern unsigned char strings[256][2];
extern unsigned char no_str[];
extern unsigned short strange_chars[32];

void free_translation_table(struct conv_table *p);
void new_translation_table(struct conv_table *p);

#endif
