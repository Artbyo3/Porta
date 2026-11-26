#!/bin/sh
# Launch Porta on Linux. Run with: sh START.sh  (works when the stick has no exec permissions)
D="$(cd "$(dirname "$0")" && pwd)"
B="$D/porta-linux"
export PORTA_HOME="$D"
cd "$D" || exit 1
if [ -x "$B" ]; then exec "$B"; fi
# No exec permission on this filesystem: load the binary into memory and run it from there. Nothing is written to disk.
if command -v python3 >/dev/null 2>&1; then
  exec python3 -c 'import os,sys
fd=os.memfd_create("porta")
os.write(fd,open(sys.argv[1],"rb").read())
os.execv("/proc/self/fd/%d"%fd,[sys.argv[1]])' "$B"
fi
if command -v perl >/dev/null 2>&1; then
  exec perl -MPOSIX -e 'my $fd=syscall(319,"porta",0); die "memfd_create failed\n" if $fd<0;
open(my $i,"<:raw",$ARGV[0]) or die; local $/; my $b=<$i>; my $o=0;
while($o<length $b){my $n=POSIX::write($fd,substr($b,$o),length($b)-$o); die "write failed\n" unless $n; $o+=$n}
exec {"/proc/self/fd/$fd"} $ARGV[0]' "$B"
fi
echo "Porta: this filesystem does not allow running programs, and neither python3 nor perl is available." >&2
exit 1
