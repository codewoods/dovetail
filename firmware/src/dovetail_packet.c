/*
 * dovetail_packet.c — Little-endian binary encoder for the three protocol packets.
 *
 * Pure C99; no dynamic allocation; suitable for constrained low-bandwidth devices.
 * AEAD encryption lives in firmware/src/dovetail_aead.c (linked against mbedTLS).
 *
 */

#include "dovetail_packet.h"
#include <string.h>

/* Little-endian writers — match TS DataView.setUint*(..., true). */
static void w_u8 (uint8_t *b, uint8_t v)   { b[0] = v; }
static void w_u16(uint8_t *b, uint16_t v)  { b[0] = (uint8_t)(v & 0xff); b[1] = (uint8_t)((v >> 8) & 0xff); }
static void w_i16(uint8_t *b, int16_t v)   { w_u16(b, (uint16_t)v); }
static void w_u32(uint8_t *b, uint32_t v) {
  b[0] = (uint8_t)(v & 0xff); b[1] = (uint8_t)((v >> 8) & 0xff);
  b[2] = (uint8_t)((v >> 16) & 0xff); b[3] = (uint8_t)((v >> 24) & 0xff);
}
static void w_i32(uint8_t *b, int32_t v) { w_u32(b, (uint32_t)v); }

int dovetail_encode_person(const dovetail_person_t *p, uint8_t *out, size_t out_size) {
  if (out_size < DOVETAIL_PERSON_PLAINTEXT_SIZE) return -1;
  memcpy(out + 0, p->mac, DOVETAIL_MAC_LEN);   /* 0-5 */
  w_u32(out + 6, p->village);                 /* 6-9 */
  w_u32(out + 10, p->ts);                     /* 10-13 */
  w_i32(out + 14, p->lat_fp);                 /* 14-17 */
  w_i32(out + 18, p->lng_fp);                 /* 18-21 */
  w_i16(out + 22, p->alt_m);                  /* 22-23 */
  memcpy(out + 24, p->addr, DOVETAIL_ADDR_LEN); /* 24-30 */
  w_u8 (out + 31, p->count);                  /* 31 */
  w_u8 (out + 32, p->status);                 /* 32 */
  w_u16(out + 33, p->flags);                  /* 33-34 */
  return DOVETAIL_PERSON_PLAINTEXT_SIZE;
}

int dovetail_encode_terrain(const dovetail_terrain_t *p, uint8_t *out, size_t out_size) {
  if (out_size < DOVETAIL_TERRAIN_PLAINTEXT_SIZE) return -1;
  memcpy(out + 0, p->mac, DOVETAIL_MAC_LEN);   /* 0-5 */
  w_u32(out + 6, p->ts);                      /* 6-9 */
  w_i32(out + 10, p->lat_fp);                 /* 10-13 */
  w_i32(out + 14, p->lng_fp);                 /* 14-17 */
  w_u8 (out + 18, p->event);                  /* 18 */
  w_u16(out + 19, p->extent_m);               /* 19-20 */
  w_u8 (out + 21, p->severity);               /* 21 */
  w_u16(out + 22, p->flags);                  /* 22-23 */
  return DOVETAIL_TERRAIN_PLAINTEXT_SIZE;
}

int dovetail_encode_resource(const dovetail_resource_t *p, uint8_t *out, size_t out_size) {
  if (out_size < DOVETAIL_RESOURCE_PLAINTEXT_SIZE) return -1;
  memcpy(out + 0, p->mac, DOVETAIL_MAC_LEN);   /* 0-5 */
  w_u32(out + 6, p->ts);                      /* 6-9 */
  w_i32(out + 10, p->lat_fp);                 /* 10-13 */
  w_i32(out + 14, p->lng_fp);                 /* 14-17 */
  memcpy(out + 18, p->addr, DOVETAIL_ADDR_LEN); /* 18-24 */
  w_u16(out + 25, p->resource);               /* 25-26 */
  w_u8 (out + 27, p->quantity);               /* 27 */
  w_u8 (out + 28, p->duration_h);             /* 28 */
  w_u16(out + 29, p->flags);                  /* 29-30 */
  return DOVETAIL_RESOURCE_PLAINTEXT_SIZE;
}

/* Local dictionary — keep in sync with src/packet/addr.ts. */
typedef struct {
  const char *label;
  uint8_t tag;
} addr_entry_t;

static const addr_entry_t addr_dict[] = {
  {"UNKNOWN_LANDSLIDE",   DOVETAIL_ADDR_TAG_UNKNOWN_LANDSLIDE},
  {"UNKNOWN_FLOOD",       DOVETAIL_ADDR_TAG_UNKNOWN_FLOOD},
  {"UNKNOWN_FIRE",        DOVETAIL_ADDR_TAG_UNKNOWN_FIRE},
  {"UNKNOWN_COLLAPSE",    DOVETAIL_ADDR_TAG_UNKNOWN_COLLAPSE},
  {"NO_ADDRESS_LOCAL",    DOVETAIL_ADDR_TAG_NO_ADDRESS_LOCAL},
  {"NO_ADDRESS_EXTERNAL", DOVETAIL_ADDR_TAG_NO_ADDRESS_EXTERNAL},
  {"TRANSIENT",           DOVETAIL_ADDR_TAG_TRANSIENT},
  {"VEHICLE",             DOVETAIL_ADDR_TAG_VEHICLE},
  {"CAMPSITE_OFFICIAL",   DOVETAIL_ADDR_TAG_CAMPSITE_OFFICIAL},
  {"CAMPSITE_WILD",       DOVETAIL_ADDR_TAG_CAMPSITE_WILD},
  {"GROUP_TOUR",          DOVETAIL_ADDR_TAG_GROUP_TOUR},
  {"WORKSITE",            DOVETAIL_ADDR_TAG_WORKSITE},
  {"ARTIST_RESIDENCY",    DOVETAIL_ADDR_TAG_ARTIST_RESIDENCY},
  {"FESTIVAL_VENUE",      DOVETAIL_ADDR_TAG_FESTIVAL_VENUE},
  {"MOBILE_VENDOR",       DOVETAIL_ADDR_TAG_MOBILE_VENDOR},
};

int dovetail_encode_addr(const char *label, uint8_t out[DOVETAIL_ADDR_LEN]) {
  if (!label || !out) return -1;
  memset(out, 0, DOVETAIL_ADDR_LEN);
  for (size_t i = 0; i < sizeof(addr_dict) / sizeof(addr_dict[0]); ++i) {
    if (strcmp(label, addr_dict[i].label) == 0) {
      out[0] = addr_dict[i].tag;
      return 0;
    }
  }
  /* TGOS fallback: tag 0x00 + up to 6 ASCII bytes of the label */
  out[0] = DOVETAIL_ADDR_TAG_TGOS;
  size_t copied = 0;
  for (size_t i = 0; copied < (DOVETAIL_ADDR_LEN - 1) && label[i] != '\0'; ++i) {
    out[1 + copied] = (uint8_t)label[i];
    copied++;
  }
  return 0;
}
