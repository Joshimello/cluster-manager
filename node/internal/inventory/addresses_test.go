package inventory

import (
	"net/netip"
	"reflect"
	"testing"
)

func TestOrderedIPAddresses(t *testing.T) {
	candidates := []interfaceAddress{
		{"docker0", netip.MustParseAddr("172.17.0.1")},
		{"eth0", netip.MustParseAddr("2001:db8::1")},
		{"eth0", netip.MustParseAddr("192.168.1.50")},
		{"eth0", netip.MustParseAddr("192.168.1.50")},
		{"lo", netip.MustParseAddr("127.0.0.1")},
		{"eth0", netip.MustParseAddr("fe80::1")},
		{"eth0", netip.MustParseAddr("169.254.1.1")},
		{"eth0", netip.MustParseAddr("0.0.0.0")},
		{"eth0", netip.MustParseAddr("224.0.0.1")},
	}
	want := []string{"192.168.1.50", "2001:db8::1", "172.17.0.1"}
	if got := orderedIPAddresses(candidates, "eth0"); !reflect.DeepEqual(got, want) {
		t.Fatalf("addresses = %v, want %v", got, want)
	}
	if got := orderedIPAddresses(nil, ""); len(got) != 0 {
		t.Fatalf("empty interfaces = %v", got)
	}
}

func TestDefaultRouteInterface(t *testing.T) {
	routes := "Iface Destination Gateway Flags RefCnt Use Metric Mask\n" +
		"eth1 00000000 0100000A 0003 0 0 100 00000000\n" +
		"eth0 00000000 0101A8C0 0003 0 0 10 00000000\n" +
		"down0 00000000 0101A8C0 0000 0 0 0 00000000\n" +
		"eth2 00000000 00000000 0001 0 0 0 00FFFFFF\n"
	if got := defaultRouteInterface(routes); got != "eth0" {
		t.Fatalf("default route = %q", got)
	}
	if got := defaultRouteInterface("unavailable"); got != "" {
		t.Fatalf("missing route = %q", got)
	}
}
