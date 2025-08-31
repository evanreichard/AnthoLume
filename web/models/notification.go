package models

type NotificationType int

const (
	NotificationTypeSuccess NotificationType = iota
	NotificationTypeError
)

type Notification struct {
	Content string
	Type    NotificationType
}
