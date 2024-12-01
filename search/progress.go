package search

type writeCounter struct {
	Total            int64
	Current          int64
	ProgressFunction func(float32)
}

func (wc *writeCounter) Write(p []byte) (int, error) {
	n := len(p)
	wc.Current += int64(n)
	wc.flushProgress()
	return n, nil
}

func (wc *writeCounter) flushProgress() {
	if wc.ProgressFunction == nil || wc.Total < 100000 {
		return
	}
	percentage := float32(wc.Current) * 100 / float32(wc.Total)
	wc.ProgressFunction(percentage)
}
