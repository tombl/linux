#!/usr/bin/env perl

use strict;
use warnings;

my %keep = map { $_ => 1 } qw(
    .initcallearly.init
    .initcall1.init .initcall1s.init
    .initcall2.init .initcall2s.init
    .initcall3.init .initcall3s.init
    .initcall4.init .initcall4s.init
    .initcall5.init .initcall5s.init
    .initcallrootfs.init
    .initcall6.init .initcall6s.init
    .initcall7.init .initcall7s.init

    __param
    .con_initcall.init
    .init.setup

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
    last if /data\.drop/;

    if (/i32\.const (\d+)/) {
        push @stack, $1;
        next;
    }
    
    if (/memory\.init \$(.+)/) {
        if (scalar(@stack) < 3) {
            die "not a simple init: $1\n";
            # @stack = ();
            # next;
        }

        my ($addr, $idx, $size) = @stack[-3..-1]; my
        @stack = ();

        my $name = $1;
        if (!$keep{$name}) {
            warn "skipping $name\n";
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