package utils

func Ternary[T any](cond bool, tVal, fVal T) T {
	if cond {
		return tVal
	}
	return fVal
}

func FirstNonZero[T comparable](v ...T) T {
	var zero T
	for _, val := range v {
		if val != zero {
			return val
		}
	}
	return zero
}
