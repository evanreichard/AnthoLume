package sliceutils

func First[T any](s []T) (T, bool) {
	if len(s) == 0 {
		var zeroT T
		return zeroT, false
	}
	return s[0], true
}

func Map[R, I any](s []I, f func(I) R) []R {
	r := make([]R, 0, len(s))
	for _, v := range s {
		r = append(r, f(v))
	}
	return r
}
