package models

type UserInfo struct {
	Username string
	IsAdmin  bool
}

type ServerInfo struct {
	RegistrationEnabled bool
	SearchEnabled       bool
	Version             string
}
