/*
 * test_encode.c — Host-side fixture comparing C encoder bytes with the
 * expected plaintext bytes that the TypeScript codec produces (src/packet/codec.ts).
 *
 * Build: gcc -Wall -Wextra -O0 -g -Iinclude src/dovetail_packet.c test/test_encode.c -o build/test_encode
 * Run:   ./build/test_encode  -> exits 0 on success, prints diff and exits 1 otherwise.
 *
 * Fixture mirrors test/codec.test.ts "person_report round-trip" case.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "dovetail_packet.h"

static int hex_dump(const char *label, const uint8_t *bytes, size_t n) {
  printf("%s (%zu bytes): ", label, n);
  for (size_t i = 0; i < n; ++i) printf("%02x", bytes[i]);
  printf("\n");
  return 0;
}

static int check_equal(const char *label, const uint8_t *a, const uint8_t *b, size_t n) {
  if (memcmp(a, b, n) == 0) { printf("[PASS] %s\n", label); return 0; }
  printf("[FAIL] %s\n", label);
  hex_dump("  got     ", a, n);
  hex_dump("  expected", b, n);
  return 1;
}

static int test_person(void) {
  dovetail_person_t p = {
    .mac     = {0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x01},
    .village = 1003012,
    .ts      = 1759058400,
    .lat_fp  = 123400000,    /* 12.34 * 1e7 */
    .lng_fp  = 567800000,    /* 56.78 * 1e7 */
    .alt_m   = 142,
    .count   = 3,
    .status  = DOVETAIL_STATUS_EVACUATED_SHELTER,
    .flags   = DOVETAIL_FLAG_SPECIAL_NEEDS | DOVETAIL_FLAG_LONG_TERM_CARE | DOVETAIL_FLAG_ON_SITE,
  };
  dovetail_encode_addr("CN5630", p.addr);

  uint8_t buf[DOVETAIL_PERSON_PLAINTEXT_SIZE];
  int written = dovetail_encode_person(&p, buf, sizeof(buf));
  if (written != DOVETAIL_PERSON_PLAINTEXT_SIZE) {
    fprintf(stderr, "encode returned %d\n", written); return 1;
  }

  /* Expected bytes derived from the TS encoder applied to the same struct.
   * mac(5C8AF3000001) village(1003012=0x000F4E04 LE) ts(1759058400=0x68D919E0 LE)
   * lat_fp(123400000=0x075AEF40 LE) lng_fp(567800000=0x21D7F0C0 LE)
   * alt(142=0x008E LE) addr(tag00 + 'CN5630') count(03)
   * status(01) flags(0x0106 = bit1+bit2+bit8 LE) */
  static const uint8_t expected[DOVETAIL_PERSON_PLAINTEXT_SIZE] = {
    /* mac        */ 0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x01,
    /* village    */ 0x04, 0x4E, 0x0F, 0x00,
    /* ts         */ 0xE0, 0x19, 0xD9, 0x68,
    /* lat_fp     */ 0x40, 0xEF, 0x5A, 0x07,
    /* lng_fp     */ 0xC0, 0xF0, 0xD7, 0x21,
    /* alt        */ 0x8E, 0x00,
    /* addr (tag00 + CN5630)*/ 0x00, 0x43, 0x4E, 0x35, 0x36, 0x33, 0x30,
    /* count      */ 0x03,
    /* status     */ 0x01,
    /* flags      */ 0x06, 0x01,
  };
  return check_equal("person_report plaintext", buf, expected, DOVETAIL_PERSON_PLAINTEXT_SIZE);
}

static int test_terrain(void) {
  dovetail_terrain_t t = {
    .mac     = {0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x06},
    .ts      = 1759058500,
    .lat_fp  = 123400000,
    .lng_fp  = 567800000,
    .event   = DOVETAIL_EVT_LANDSLIDE,
    .extent_m = 200,
    .severity = 230,
    .flags    = 0,
  };
  uint8_t buf[DOVETAIL_TERRAIN_PLAINTEXT_SIZE];
  int written = dovetail_encode_terrain(&t, buf, sizeof(buf));
  if (written != DOVETAIL_TERRAIN_PLAINTEXT_SIZE) {
    fprintf(stderr, "encode returned %d\n", written); return 1;
  }
  /* size + non-zero structural checks */
  if (buf[0] != 0x5C) { printf("[FAIL] terrain mac[0]\n"); return 1; }
  if (buf[18] != DOVETAIL_EVT_LANDSLIDE) { printf("[FAIL] terrain event byte\n"); return 1; }
  if (buf[21] != 230) { printf("[FAIL] terrain severity\n"); return 1; }
  printf("[PASS] terrain_event structural\n");
  return 0;
}

static int test_terrain_extended_contract(void) {
  dovetail_terrain_t t = {
    .mac      = {0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x07},
    .ts       = 1759058700,
    .lat_fp   = 123400000,
    .lng_fp   = 567800000,
    .event    = DOVETAIL_EVT_DRAINAGE_BACKFLOW,
    .extent_m = 350,
    .severity = 210,
    .flags    = DOVETAIL_TERRAIN_FLAG_RAPID_RAINFALL | DOVETAIL_TERRAIN_FLAG_BACKFLOW_OBSERVED,
  };
  uint8_t buf[DOVETAIL_TERRAIN_PLAINTEXT_SIZE];
  int written = dovetail_encode_terrain(&t, buf, sizeof(buf));
  if (written != DOVETAIL_TERRAIN_PLAINTEXT_SIZE) { fprintf(stderr, "encode returned %d\n", written); return 1; }

  if (buf[18] != 15) { printf("[FAIL] terrain drainage_backflow enum\n"); return 1; }
  if (buf[22] != 0x09 || buf[23] != 0x00) { printf("[FAIL] terrain flags bitmap\n"); return 1; }
  printf("[PASS] terrain_event extended contract\n");
  return 0;
}

static int test_resource(void) {
  dovetail_resource_t r = {
    .mac     = {0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x05},
    .ts      = 1759058600,
    .lat_fp  = 123400000,
    .lng_fp  = 567800000,
    .resource  = DOVETAIL_RES_FOOD_WATER | DOVETAIL_RES_MANPOWER,
    .quantity  = 5,
    .duration_h = 24,
    .flags    = DOVETAIL_RES_FLAG_URGENT,
  };
  dovetail_encode_addr("WORKSITE", r.addr);

  uint8_t buf[DOVETAIL_RESOURCE_PLAINTEXT_SIZE];
  int written = dovetail_encode_resource(&r, buf, sizeof(buf));
  if (written != DOVETAIL_RESOURCE_PLAINTEXT_SIZE) { fprintf(stderr, "encode returned %d\n", written); return 1; }

  if (buf[18] != DOVETAIL_ADDR_TAG_WORKSITE) { printf("[FAIL] resource addr tag (WORKSITE expected 0x33)\n"); return 1; }
  if (buf[27] != 5) { printf("[FAIL] resource quantity\n"); return 1; }
  if (buf[28] != 24) { printf("[FAIL] resource duration\n"); return 1; }
  /* resource bitmap: food_water bit 4 = 0x10, manpower bit 7 = 0x80 → low byte 0x90 */
  if (buf[25] != 0x90 || buf[26] != 0x00) { printf("[FAIL] resource bitmap\n"); return 1; }
  printf("[PASS] resource_report structural\n");
  return 0;
}

static int test_resource_extended_contract(void) {
  dovetail_resource_t r = {
    .mac       = {0x5C, 0x8A, 0xF3, 0x00, 0x00, 0x08},
    .ts        = 1759058800,
    .lat_fp    = 123400000,
    .lng_fp    = 567800000,
    .resource  = DOVETAIL_RES_WARMTH_SUPPLIES | DOVETAIL_RES_MENSTRUAL_SUPPLIES,
    .quantity  = 9,
    .duration_h = 0,
    .flags     = DOVETAIL_RES_FLAG_IS_REQUEST | DOVETAIL_RES_FLAG_URGENT,
  };
  dovetail_encode_addr("UNKNOWN_FLOOD", r.addr);

  uint8_t buf[DOVETAIL_RESOURCE_PLAINTEXT_SIZE];
  int written = dovetail_encode_resource(&r, buf, sizeof(buf));
  if (written != DOVETAIL_RESOURCE_PLAINTEXT_SIZE) { fprintf(stderr, "encode returned %d\n", written); return 1; }

  if (buf[25] != 0x00 || buf[26] != 0x03) { printf("[FAIL] resource extended bitmap\n"); return 1; }
  if (buf[29] != 0x03 || buf[30] != 0x00) { printf("[FAIL] resource request/urgent flags\n"); return 1; }
  printf("[PASS] resource_report extended contract\n");
  return 0;
}

int main(void) {
  int failed = 0;
  failed += test_person();
  failed += test_terrain();
  failed += test_terrain_extended_contract();
  failed += test_resource();
  failed += test_resource_extended_contract();
  if (failed == 0) {
    printf("\nAll firmware encoder tests passed.\n");
    return 0;
  }
  printf("\n%d firmware encoder tests FAILED.\n", failed);
  return 1;
}
