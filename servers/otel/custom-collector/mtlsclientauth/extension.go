// Copyright TeamB SIEM
// SPDX-License-Identifier: Apache-2.0

// Package mtlsclientauth is a minimal server authenticator extension for the
// OTel Collector's otlpreceiver. It exists because otelcol-contrib has no
// built-in mechanism to expose a verified mTLS client certificate's
// Subject.CommonName to the processing pipeline (attributesprocessor's
// from_context only reads metadata./auth./client.address - "auth." is
// populated by an authenticator extension implementing client.AuthData, and
// no such extension ships for raw TLS peer certificates). This fills that
// one gap: it reads the peer certificate already verified by the gRPC
// server's TLS handshake (client_ca_file / RequireAndVerifyClientCert on the
// otlpreceiver) and republishes its CN as auth.cn.
package mtlsclientauth // import "github.com/teamb-siem/mtlsclientauth"

import (
	"context"
	"errors"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

var (
	_ extension.Extension  = (*mtlsClientAuth)(nil)
	_ extensionauth.Server = (*mtlsClientAuth)(nil)
	_ client.AuthData      = (*authData)(nil)
)

var errNoPeerTLSCertificate = errors.New("no verified peer TLS certificate on this connection")

type authData struct {
	cn string
}

func (a *authData) GetAttribute(name string) any {
	if name == "cn" {
		return a.cn
	}
	return nil
}

func (a *authData) GetAttributeNames() []string {
	return []string{"cn"}
}

type mtlsClientAuth struct {
	settings extension.Settings
}

func newMTLSClientAuth(_ *Config, set extension.Settings) *mtlsClientAuth {
	return &mtlsClientAuth{settings: set}
}

func (m *mtlsClientAuth) Start(_ context.Context, _ component.Host) error {
	return nil
}

func (m *mtlsClientAuth) Shutdown(_ context.Context) error {
	return nil
}

// Authenticate runs once per RPC, after the gRPC server's TLS handshake has
// already verified the client certificate against client_ca_file (otelcol's
// otlpreceiver TLS config). It does not re-verify anything - it only reads
// the CN out of the certificate the transport layer already accepted, the
// same way passTLSClientCert would have if Traefik were still terminating
// TLS here.
func (m *mtlsClientAuth) Authenticate(ctx context.Context, _ map[string][]string) (context.Context, error) {
	p, ok := peer.FromContext(ctx)
	if !ok {
		return ctx, errNoPeerTLSCertificate
	}
	tlsInfo, ok := p.AuthInfo.(credentials.TLSInfo)
	if !ok || len(tlsInfo.State.PeerCertificates) == 0 {
		return ctx, errNoPeerTLSCertificate
	}
	cn := tlsInfo.State.PeerCertificates[0].Subject.CommonName
	if cn == "" {
		return ctx, errNoPeerTLSCertificate
	}

	cl := client.FromContext(ctx)
	cl.Auth = &authData{cn: cn}
	return client.NewContext(ctx, cl), nil
}
