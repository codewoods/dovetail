/*
 * dovetail_packet.h — Binary layout for the three protocol packets.
 *
 * Mirrors SPEC.md §4. The structs are pure plaintext bodies — encryption
 * with mbedTLS AES-128-CCM happens in a separate translation unit when a
 * hardware device profile links mbedTLS. Host-side tests (test/test_encode.c) verify the
 * deterministic plaintext bytes match the TypeScript codec.
 *
 */

#ifndef DOVETAIL_PACKET_H
#define DOVETAIL_PACKET_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DOVETAIL_TYPE_PERSON_REPORT    0x01
#define DOVETAIL_TYPE_TERRAIN_EVENT    0x02
#define DOVETAIL_TYPE_RESOURCE_REPORT  0x03

/* Wire sizes excluding the AEAD tag — plaintext only. AEAD tag (4 bytes)
 * is appended in the encrypt step, producing the over-the-air frame sizes
 * 40 / 29 / 36 documented in spec §2. */
#define DOVETAIL_PERSON_PLAINTEXT_SIZE    35
#define DOVETAIL_TERRAIN_PLAINTEXT_SIZE   24
#define DOVETAIL_RESOURCE_PLAINTEXT_SIZE  31

#define DOVETAIL_PERSON_FRAME_SIZE    40
#define DOVETAIL_TERRAIN_FRAME_SIZE   29
#define DOVETAIL_RESOURCE_FRAME_SIZE  36

#define DOVETAIL_AEAD_TAG_LEN_BYTES   4
#define DOVETAIL_ADDR_LEN             7
#define DOVETAIL_MAC_LEN              6
#define DOVETAIL_COORD_SCALE          10000000  /* 1e7 */

/* status enum — matches SPEC.md §5.1 ordering */
typedef enum {
  DOVETAIL_STATUS_UNKNOWN                  = 0,
  DOVETAIL_STATUS_EVACUATED_SHELTER        = 1,
  DOVETAIL_STATUS_EVACUATED_RELATIVES      = 2,
  DOVETAIL_STATUS_VERTICAL_EVACUATED       = 3,
  DOVETAIL_STATUS_REFUSED                  = 4,
  DOVETAIL_STATUS_RESCUE_NEEDED            = 5,
  DOVETAIL_STATUS_SELF_EVACUATED_NEIGHBOR  = 6,
  DOVETAIL_STATUS_ADDRESS_LOST             = 7
} dovetail_status_t;

/* terrain event enum — matches SPEC.md §5.3 (1-based per spec) */
typedef enum {
  DOVETAIL_EVT_ROAD_BLOCKED          = 1,
  DOVETAIL_EVT_BRIDGE_COLLAPSED      = 2,
  DOVETAIL_EVT_LANDSLIDE             = 3,
  DOVETAIL_EVT_FLOOD                 = 4,
  DOVETAIL_EVT_BUILDING_COLLAPSE     = 5,
  DOVETAIL_EVT_FIRE                  = 6,
  DOVETAIL_EVT_RIVER_DIVERTED        = 7,
  DOVETAIL_EVT_POWER_OUTAGE_AREA     = 8,
  DOVETAIL_EVT_SIGNAL_LOST           = 9,
  DOVETAIL_EVT_WATER_COLOR_CHANGE    = 10,
  DOVETAIL_EVT_MOUNTAIN_RUMBLING     = 11,
  DOVETAIL_EVT_SUDDEN_ANIMAL_BEHAVIOR = 12,
  DOVETAIL_EVT_GROUND_CRACKING       = 13,
  DOVETAIL_EVT_UNUSUAL_SMELL         = 14,
  DOVETAIL_EVT_DRAINAGE_BACKFLOW     = 15
} dovetail_terrain_event_t;

/* person flag bits — matches SPEC.md §5.2 */
#define DOVETAIL_FLAG_INJURED                   (1u << 0)
#define DOVETAIL_FLAG_SPECIAL_NEEDS             (1u << 1)
#define DOVETAIL_FLAG_LONG_TERM_CARE            (1u << 2)
#define DOVETAIL_FLAG_TRAPPED                   (1u << 3)
#define DOVETAIL_FLAG_NON_RESIDENT              (1u << 4)
#define DOVETAIL_FLAG_FOREIGN_VISITOR           (1u << 5)
#define DOVETAIL_FLAG_MIGRANT_WORKER            (1u << 6)
#define DOVETAIL_FLAG_STATUS_CHANGED            (1u << 7)
#define DOVETAIL_FLAG_ON_SITE                   (1u << 8)
#define DOVETAIL_FLAG_VERTICAL_EVACUATION       (1u << 9)
#define DOVETAIL_FLAG_NO_FIXED_ADDRESS          (1u << 10)
#define DOVETAIL_FLAG_GNSS_DEGRADED             (1u << 11)
#define DOVETAIL_FLAG_REQUIRES_SEPARATED_SPACE  (1u << 12)
#define DOVETAIL_FLAG_CONSENT_ACKNOWLEDGED      (1u << 13)
#define DOVETAIL_FLAG_CONSENT_REFUSED           (1u << 14)

/* terrain flag bits — matches SPEC.md §5.4 */
#define DOVETAIL_TERRAIN_FLAG_RAPID_RAINFALL     (1u << 0)
#define DOVETAIL_TERRAIN_FLAG_ONLY_EXIT_CONTROL  (1u << 1)
#define DOVETAIL_TERRAIN_FLAG_VEHICLES_TRAPPED   (1u << 2)
#define DOVETAIL_TERRAIN_FLAG_BACKFLOW_OBSERVED  (1u << 3)

/* resource kind bits — matches SPEC.md §5.5 */
#define DOVETAIL_RES_VEHICLE_TRANSPORT  (1u << 0)
#define DOVETAIL_RES_SHELTER_SPACE      (1u << 1)
#define DOVETAIL_RES_POWER_GENERATOR    (1u << 2)
#define DOVETAIL_RES_MEDICAL_AID        (1u << 3)
#define DOVETAIL_RES_FOOD_WATER         (1u << 4)
#define DOVETAIL_RES_COMMUNICATION      (1u << 5)
#define DOVETAIL_RES_FUEL               (1u << 6)
#define DOVETAIL_RES_MANPOWER           (1u << 7)
#define DOVETAIL_RES_WARMTH_SUPPLIES    (1u << 8)
#define DOVETAIL_RES_MENSTRUAL_SUPPLIES (1u << 9)

#define DOVETAIL_RES_FLAG_IS_REQUEST    (1u << 0)
#define DOVETAIL_RES_FLAG_URGENT        (1u << 1)

/* Addr tag prefix — matches SPEC.md §6 dictionary */
#define DOVETAIL_ADDR_TAG_TGOS                0x00
#define DOVETAIL_ADDR_TAG_UNKNOWN_LANDSLIDE   0x10
#define DOVETAIL_ADDR_TAG_UNKNOWN_FLOOD       0x11
#define DOVETAIL_ADDR_TAG_UNKNOWN_FIRE        0x12
#define DOVETAIL_ADDR_TAG_UNKNOWN_COLLAPSE    0x13
#define DOVETAIL_ADDR_TAG_NO_ADDRESS_LOCAL    0x20
#define DOVETAIL_ADDR_TAG_NO_ADDRESS_EXTERNAL 0x21
#define DOVETAIL_ADDR_TAG_TRANSIENT           0x22
#define DOVETAIL_ADDR_TAG_VEHICLE             0x23
#define DOVETAIL_ADDR_TAG_CAMPSITE_OFFICIAL   0x30
#define DOVETAIL_ADDR_TAG_CAMPSITE_WILD       0x31
#define DOVETAIL_ADDR_TAG_GROUP_TOUR          0x32
#define DOVETAIL_ADDR_TAG_WORKSITE            0x33
#define DOVETAIL_ADDR_TAG_ARTIST_RESIDENCY    0x34
#define DOVETAIL_ADDR_TAG_FESTIVAL_VENUE      0x35
#define DOVETAIL_ADDR_TAG_MOBILE_VENDOR       0x36

/* Plaintext bodies — type byte is not stored here; it lives at offset 0 of
 * the over-the-air frame as AEAD AAD. */

typedef struct {
  uint8_t  mac[DOVETAIL_MAC_LEN];
  uint32_t village;
  uint32_t ts;
  int32_t  lat_fp;   /* lat * 1e7 */
  int32_t  lng_fp;   /* lng * 1e7 */
  int16_t  alt_m;
  uint8_t  addr[DOVETAIL_ADDR_LEN];
  uint8_t  count;
  uint8_t  status;   /* dovetail_status_t */
  uint16_t flags;
} dovetail_person_t;

typedef struct {
  uint8_t  mac[DOVETAIL_MAC_LEN];
  uint32_t ts;
  int32_t  lat_fp;
  int32_t  lng_fp;
  uint8_t  event;    /* dovetail_terrain_event_t (1-based) */
  uint16_t extent_m;
  uint8_t  severity;
  uint16_t flags;
} dovetail_terrain_t;

typedef struct {
  uint8_t  mac[DOVETAIL_MAC_LEN];
  uint32_t ts;
  int32_t  lat_fp;
  int32_t  lng_fp;
  uint8_t  addr[DOVETAIL_ADDR_LEN];
  uint16_t resource;
  uint8_t  quantity;
  uint8_t  duration_h;
  uint16_t flags;
} dovetail_resource_t;

/* Encode plaintext into the caller-supplied buffer.
 * Returns number of bytes written (always the PLAINTEXT_SIZE constant) on
 * success, or -1 if out_size is insufficient. The wire layout is little-endian
 * to match the TS codec (DataView default + setUint*(..., true)). */
int dovetail_encode_person(const dovetail_person_t *p, uint8_t *out, size_t out_size);
int dovetail_encode_terrain(const dovetail_terrain_t *p, uint8_t *out, size_t out_size);
int dovetail_encode_resource(const dovetail_resource_t *p, uint8_t *out, size_t out_size);

/* Encode an addr label (NUL-terminated C string) into the 7-byte addr field
 * with the dictionary tag layout described in SPEC.md §6. Returns 0 on
 * success, -1 if the label is unknown and not a TGOS-style fallback. */
int dovetail_encode_addr(const char *label, uint8_t out[DOVETAIL_ADDR_LEN]);

#ifdef __cplusplus
}
#endif

#endif /* DOVETAIL_PACKET_H */
