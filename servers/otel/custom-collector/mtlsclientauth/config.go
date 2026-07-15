// Copyright TeamB SIEM
// SPDX-License-Identifier: Apache-2.0

package mtlsclientauth // import "github.com/teamb-siem/mtlsclientauth"

import "go.opentelemetry.io/collector/component"

// Config has no user-facing fields: the extension always extracts the
// verified peer certificate's Subject.CommonName from the gRPC connection's
// TLS state and exposes it as auth.cn.
type Config struct {
	// prevent unkeyed literal initialization
	_ struct{}
}

var _ component.Config = (*Config)(nil)

func (cfg *Config) Validate() error {
	return nil
}
