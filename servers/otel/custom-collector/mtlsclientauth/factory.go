// Copyright TeamB SIEM
// SPDX-License-Identifier: Apache-2.0

package mtlsclientauth // import "github.com/teamb-siem/mtlsclientauth"

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
)

var componentType = component.MustNewType("mtlsclientauth")

// NewFactory creates a factory for the mTLS client-certificate CN authenticator extension.
func NewFactory() extension.Factory {
	return extension.NewFactory(
		componentType,
		createDefaultConfig,
		createExtension,
		component.StabilityLevelDevelopment,
	)
}

func createDefaultConfig() component.Config {
	return &Config{}
}

func createExtension(_ context.Context, set extension.Settings, cfg component.Config) (extension.Extension, error) {
	return newMTLSClientAuth(cfg.(*Config), set), nil
}
