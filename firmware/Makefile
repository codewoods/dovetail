# Host-side build for firmware encoder tests.
# Board-specific builds are added only when compliant hardware is selected;
# this Makefile only verifies the wire-format C is byte-identical with the TS codec.

CC      := gcc
CFLAGS  := -Wall -Wextra -Wpedantic -Wshadow -Werror -O0 -g -std=c99 -Iinclude
BUILD   := build

.PHONY: all test clean
all: $(BUILD)/test_encode

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/test_encode: src/dovetail_packet.c test/test_encode.c | $(BUILD)
	$(CC) $(CFLAGS) src/dovetail_packet.c test/test_encode.c -o $@

test: $(BUILD)/test_encode
	./$(BUILD)/test_encode

clean:
	rm -rf $(BUILD)
