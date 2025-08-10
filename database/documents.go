package database

import (
	"context"
	"fmt"

	"reichard.io/antholume/pkg/ptr"
	"reichard.io/antholume/pkg/sliceutils"
)

func (d *DBManager) GetDocument(ctx context.Context, docID, userID string) (*GetDocumentsWithStatsRow, error) {
	documents, err := d.Queries.GetDocumentsWithStats(ctx, GetDocumentsWithStatsParams{
		ID:     ptr.Of(docID),
		UserID: userID,
		Limit:  1,
	})
	if err != nil {
		return nil, err
	}

	document, found := sliceutils.First(documents)
	if !found {
		return nil, fmt.Errorf("document not found: %s", docID)
	}

	return &document, nil
}
