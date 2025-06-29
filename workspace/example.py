#!/usr/bin/env python3
"""
Example Python file for Web Code Editor
Demonstrates various Python features and syntax highlighting
"""

import os
import json
import datetime
from typing import List, Dict, Optional

class WebCodeEditor:
    """A class representing the Web Code Editor."""
    
    def __init__(self, name: str, version: str = "1.0.0"):
        self.name = name
        self.version = version
        self.features = [
            "Code editing with syntax highlighting",
            "File management",
            "Terminal access", 
            "Multi-tab support",
            "Upload/Download files",
            "Dark theme interface"
        ]
        self.created_at = datetime.datetime.now()
    
    def get_info(self) -> Dict[str, any]:
        """Get information about the editor."""
        return {
            "name": self.name,
            "version": self.version,
            "features": self.features,
            "created_at": self.created_at.isoformat(),
            "platform": os.name
        }
    
    def add_feature(self, feature: str) -> None:
        """Add a new feature to the editor."""
        if feature not in self.features:
            self.features.append(feature)
            print(f"Added feature: {feature}")
        else:
            print(f"Feature already exists: {feature}")
    
    def save_config(self, filename: str = "config.json") -> bool:
        """Save configuration to JSON file."""
        try:
            config = {
                "name": self.name,
                "version": self.version,
                "features": self.features,
                "last_updated": datetime.datetime.now().isoformat()
            }
            
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            print(f"Configuration saved to {filename}")
            return True
            
        except Exception as e:
            print(f"Error saving configuration: {e}")
            return False

def fibonacci(n: int) -> List[int]:
    """Generate Fibonacci sequence up to n numbers."""
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]
    
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    
    return fib

def analyze_file(filepath: str) -> Optional[Dict[str, any]]:
    """Analyze a file and return statistics."""
    try:
        if not os.path.exists(filepath):
            return None
        
        stats = os.stat(filepath)
        
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            lines = content.splitlines()
        
        return {
            "filename": os.path.basename(filepath),
            "size": stats.st_size,
            "lines": len(lines),
            "characters": len(content),
            "words": len(content.split()),
            "modified": datetime.datetime.fromtimestamp(stats.st_mtime).isoformat(),
            "extension": os.path.splitext(filepath)[1]
        }
    
    except Exception as e:
        print(f"Error analyzing file: {e}")
        return None

# Example usage
if __name__ == "__main__":
    print("🐍 Python Example for Web Code Editor")
    print("=" * 40)
    
    # Create editor instance
    editor = WebCodeEditor("Web Code Editor")
    
    # Display info
    info = editor.get_info()
    print(f"Editor: {info['name']} v{info['version']}")
    print(f"Platform: {info['platform']}")
    print(f"Created: {info['created_at']}")
    
    # Show features
    print("\nFeatures:")
    for i, feature in enumerate(info['features'], 1):
        print(f"  {i}. {feature}")
    
    # Generate Fibonacci sequence
    print(f"\nFibonacci sequence (first 10 numbers):")
    fib_sequence = fibonacci(10)
    print(fib_sequence)
    
    # Analyze current file
    current_file = __file__
    analysis = analyze_file(current_file)
    
    if analysis:
        print(f"\nFile Analysis for {analysis['filename']}:")
        print(f"  Size: {analysis['size']} bytes")
        print(f"  Lines: {analysis['lines']}")
        print(f"  Words: {analysis['words']}")
        print(f"  Characters: {analysis['characters']}")
        print(f"  Extension: {analysis['extension']}")
    
    # Save configuration
    editor.save_config()
    
    print("\n✅ Python example completed successfully!") 