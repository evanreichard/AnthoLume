package ptr

func Of[T any](v T) *T {
	return &v
}

func Deref[T any](v *T) T {
	var zeroT T
	if v == nil {
		return zeroT
	}
	return *v
}
