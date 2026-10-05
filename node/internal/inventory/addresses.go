package inventory

import (
	"net"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
)

type interfaceAddress struct {
	name string
	addr netip.Addr
}

// Read existing interface and route information only; no probes or network changes.
func ipAddresses() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var candidates []interfaceAddress
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			prefix, err := netip.ParsePrefix(address.String())
			if err == nil {
				candidates = append(candidates, interfaceAddress{iface.Name, prefix.Addr().Unmap()})
			}
		}
	}
	routes, _ := os.ReadFile("/proc/net/route")
	return orderedIPAddresses(candidates, defaultRouteInterface(string(routes)))
}

func defaultRouteInterface(routes string) string {
	name, lowestMetric := "", uint64(^uint64(0))
	for _, line := range strings.Split(routes, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 || fields[1] != "00000000" || fields[7] != "00000000" {
			continue
		}
		flags, flagErr := strconv.ParseUint(fields[3], 16, 64)
		metric, metricErr := strconv.ParseUint(fields[6], 10, 64)
		if flagErr == nil && metricErr == nil && flags&1 != 0 && metric < lowestMetric {
			name, lowestMetric = fields[0], metric
		}
	}
	return name
}

func orderedIPAddresses(candidates []interfaceAddress, defaultInterface string) []string {
	rank := func(candidate interfaceAddress) int {
		value := 0
		if candidate.name != defaultInterface {
			value += 4
		}
		if !candidate.addr.Is4() {
			value += 2
		}
		if !candidate.addr.IsPrivate() {
			value++
		}
		return value
	}
	sort.Slice(candidates, func(i, j int) bool {
		if rank(candidates[i]) != rank(candidates[j]) {
			return rank(candidates[i]) < rank(candidates[j])
		}
		return candidates[i].addr.Compare(candidates[j].addr) < 0
	})
	result := []string{}
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if !candidate.addr.IsGlobalUnicast() || candidate.addr.IsLoopback() || candidate.addr.IsLinkLocalUnicast() {
			continue
		}
		address := candidate.addr.String()
		if !seen[address] && len(result) < 64 {
			result = append(result, address)
			seen[address] = true
		}
	}
	return result
}
