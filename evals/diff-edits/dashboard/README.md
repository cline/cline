# 🚀 The Sickest Diff Edits Evaluation Dashboard Ever!

A beautiful, modern Streamlit dashboard for visualizing and analyzing diff editing evaluation results with deep drill-down capabilities.

## ✨ Features

### 🎯 **Smart Model Comparison**
- **Latest Run Focus**: Automatically loads and displays your most recent evaluation run
- **Beautiful Performance Cards**: Each model gets a stunning card with performance grades (A+ to C)
- **Best Performer Highlighting**: The top model gets special styling and a trophy 🏆
- **Interactive Charts**: Success rate comparisons and latency vs cost analysis

### 🔍 **Deep Drill-Down Analysis**
- **Individual Result Inspection**: Click any model to see detailed results
- **Side-by-Side File Views**: See original file content with line numbers
- **Parsed Tool Call Analysis**: View exactly what the model tried to do
- **Error Analysis**: Detailed error information for failed attempts
- **Success Metrics**: Line changes, edit counts, and timing breakdowns

### 🎨 **Aesthetic Design**
- **Modern UI**: Custom CSS with Inter font, gradients, and shadows
- **Responsive Layout**: Looks great on any screen size
- **Color-Coded Performance**: Green for excellent, yellow for good, red for poor
- **Smooth Animations**: Hover effects and transitions
- **Professional Styling**: Clean, modern design that looks amazing

### 📊 **Comprehensive Metrics**
- **Success Rates**: Color-coded percentages with performance grades
- **Timing Analysis**: First token, first edit, and round trip times
- **Cost Tracking**: Per-result and total cost analysis
- **Token Metrics**: Context tokens and completion tokens
- **Edit Statistics**: Number of edits, lines added/deleted

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   cd diff-edits/dashboard
   pip install -r requirements.txt
   ```

2. **Launch the dashboard**:
   ```bash
   streamlit run app.py
   ```
   
   Or use the convenient launch script:
   ```bash
   ./launch.sh
   ```

3. **Open your browser** to http://localhost:8501

## 🎯 Dashboard Sections

### **Hero Section**
- Beautiful gradient header with run information
- Key metrics overview (models tested, total results, success rate, cost)

### **Model Performance Cards**
- Each model displayed as a beautiful card
- Large success rate display with color coding
- Performance grade badges (A+, A, B+, B, C+, C)
- Key metrics: latency, cost, results count, first token time
- "Drill Down" button for detailed analysis

### **Performance Analytics**
- Interactive bar chart showing success rates
- Scatter plot of latency vs cost with bubble sizes
- Hover details and zoom capabilities

### **Detailed Analysis (Drill-Down)**
- Model-specific success rate, latency, and cost metrics
- Individual result selector with status icons
- Tabbed interface for different views:

#### 📄 **File & Edits Tab**
- **Side-by-side view**: Original file content with line numbers
- **Edit analysis**: Success/failure status with detailed metrics
- **Error display**: Clear error information for failed attempts
- **Success metrics**: Lines added/deleted, number of edits
- **Parsed tool calls**: JSON view of what the model attempted

#### 🤖 **Raw Output Tab**
- Complete raw model output in a code viewer
- Monospace font for easy reading

#### 🔧 **Parsed Tool Call Tab**
- Pretty-printed JSON of parsed tool calls
- Diff block visualization for replace_in_file calls
- Error handling for malformed JSON

#### 📊 **Metrics Tab**
- Detailed timing metrics (first token, first edit, round trip)
- Token and cost information
- Context size and completion tokens

## 🛠 **Technical Features**

### **Smart Data Loading**
- Automatic latest run detection
- Efficient SQL queries with proper JOINs
- Streamlit caching for performance
- Error handling for missing data

### **Interactive Navigation**
- Session state management for drill-down views
- Back button to return to overview
- Smooth transitions between views

### **Beautiful Styling**
- Custom CSS with Google Fonts (Inter)
- Gradient backgrounds and shadows
- Hover effects and animations
- Color-coded performance indicators
- Professional card-based layout

### **Responsive Design**
- Works on desktop, tablet, and mobile
- Flexible column layouts
- Scalable text and metrics

## 🎨 **Design Philosophy**

This dashboard follows modern design principles:
- **Clarity**: Information is easy to find and understand
- **Beauty**: Visually appealing with professional styling
- **Functionality**: Deep drill-down capabilities for detailed analysis
- **Performance**: Fast loading with efficient data queries
- **Usability**: Intuitive navigation and clear visual hierarchy

## 📊 **Data Visualization**

- **Plotly Charts**: Interactive, professional-looking visualizations
- **Color Coding**: Consistent color scheme for performance levels
- **Performance Badges**: A+ to C grading system
- **Status Icons**: ✅ for success, ❌ for failure
- **Metric Cards**: Clean, card-based metric display

## 🔧 **Customization**

The dashboard is highly customizable:
- **CSS Styling**: Easy to modify colors, fonts, and layouts
- **Performance Grades**: Adjustable thresholds for A/B/C grades
- **Metrics Display**: Add or remove metrics as needed
- **Chart Types**: Easily swap chart types or add new visualizations

## 🚀 **Future Enhancements**

Potential additions:
- **Historical Trends**: Compare performance across multiple runs
- **Export Functionality**: Download results as CSV/PDF
- **Real-time Updates**: Auto-refresh for ongoing evaluations
- **Custom Filters**: Filter by date range, model type, etc.
- **Comparison Mode**: Side-by-side model comparisons

---

**This is the sickest eval dashboard ever!** 🔥 It combines beautiful design with powerful analysis capabilities, making it easy to understand model performance at a glance while providing deep drill-down capabilities for detailed investigation.
