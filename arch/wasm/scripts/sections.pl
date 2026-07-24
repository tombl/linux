#!/usr/bin/env perl

use strict;
use warnings;

# Keep this list in sync with init_sections() in arch/wasm/kernel/sections.c.
my %keep = map { $_ => 1 } qw(
    .initcallearly.init
    .initcall0.init .initcall0s.init
    .initcall1.init .initcall1s.init
    .initcall2.init .initcall2s.init
    .initcall3.init .initcall3s.init
    .initcall4.init .initcall4s.init
    .initcall5.init .initcall5s.init
    .initcallrootfs.init
    .initcall6.init .initcall6s.init
    .initcall7.init .initcall7s.init

    __param
    __modver
    .note.Linux
    .builtin_fw
    .con_initcall.init
    .init.setup
    .data.once

    .data..percpu..first
    .data..percpu..page_aligned
    .data..percpu..read_mostly
    .data..percpu
    .data..percpu..shared_aligned
);

while (<>) {
    last if /func \$__wasm_init_memory/;
}

print "{\n";

my @stack;
my $first = 1;
while (<>) {
    last if /^\s*data\.drop\b/;

    if (/i32\.const (\d+)/) {
        push @stack, $1;
        next;
    }

    if (/memory\.init \$(.+)/) {
        if (scalar(@stack) < 3) {
            die "not a simple init: $1\n";
        }

        my ($addr, $idx, $size) = @stack[-3..-1];
        @stack = ();

        my $name = $1;
        if (!$keep{$name}) {
            next;
        }

        die "multi-memory is not supported" if $idx != 0;

        if ($first) {
            $first = 0;
        } else {
            print ",\n";
        }
        printf '  "%s": [%d, %d]', $name, $addr, $size;
    }
}

print "\n}\n";
