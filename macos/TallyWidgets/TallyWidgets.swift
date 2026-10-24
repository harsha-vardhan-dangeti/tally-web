import WidgetKit
import SwiftUI

@main
struct TallyWidgets: WidgetBundle {
    var body: some Widget {
        MonthSummaryWidget()
        QuickLogWidget()
        BillsWidget()
    }
}
